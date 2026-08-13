/* eslint-disable @typescript-eslint/naming-convention */
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import * as http from "http";
import CDP = require("chrome-remote-interface");

// Browser-side helpers for the comprehensive webresource e2e (steps 7-8): drive a real
// browser over the DevTools Protocol to (a) sign the interactive test user into the org,
// (b) open the registered form and read the onload notification banner the deployed/local
// web resource renders, and (c) confirm a hot-reload swaps the banner. Ported from the
// proven test/live browser matrix so the ui-test tsconfig (scoped to src/**) can compile it.
//
// The account MUST be excluded from MFA/conditional access — this fills the managed AAD
// sign-in form and cannot satisfy an MFA challenge.

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      const p = typeof a === "object" && a ? a.port : 0;
      srv.close(() => (p ? resolve(p) : reject(new Error("could not allocate a port"))));
    });
  });
}

export interface LaunchedBrowser {
  port: number;
  kill: () => void;
}

/**
 * Launch a Chromium browser at a URL with a fresh remote-debugging port and profile, and wait for
 * its CDP endpoint to come up. Used by step 7 to open the live app as a real user would (separate
 * from the Debug Web Resources session) and confirm the DEPLOYED web resource runs on the form.
 */
export async function launchBrowser(exePath: string, profileDir: string, url: string, timeoutMs = 25000): Promise<LaunchedBrowser> {
  fs.mkdirSync(profileDir, { recursive: true });
  const port = await freePort();
  const child = cp.spawn(
    exePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      // Prevent background-tab throttling: under ExTester the VS Code window has focus, so this Edge
      // is backgrounded and Chromium throttles its timers — which stalls AAD's sign-in transition.
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--new-window",
      url,
    ],
    { stdio: "ignore" },
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const c = await CDP({ port });
      await c.close();
      return {
        port,
        kill: () => {
          try {
            child.kill();
          } catch {
            /* ignore */
          }
        },
      };
    } catch {
      await sleep(400);
    }
  }
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  throw new Error(`browser CDP endpoint never came up on port ${port}`);
}

/** Force-kill every Chromium process whose command line references a profile dir — including the
 *  reparented child processes that `child.kill()` on the launcher shim misses. Used to fully tear
 *  down step 7's browser before step 8 launches the debug browser: a lingering Edge instance makes
 *  the new launch delegate to it, so the port-bearing process exits and the debug port can't be
 *  found. Windows-only (this harness runs on the Windows VM). */
export function killBrowsersByProfile(profileMatch: string): void {
  try {
    cp.execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*$env:DVPT_KP*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ],
      { env: { ...process.env, DVPT_KP: profileMatch }, encoding: "utf8" },
    );
  } catch {
    /* best effort */
  }
}

/**
 * Reap orphans left by a crashed/killed prior e2e run so the next run starts with headroom. On an
 * 8GB VM this matters: a debug session that dies before teardown orphans its `node webpack --watch`
 * (kept rebuilding, ~100-300MB each) and its Edge browser, and enough of them accumulated across runs
 * will starve VS Code's Electron host mid-suite (seen as ECONNREFUSED to the webdriver, run 13). This
 * is best-effort and Windows-only (the e2e only runs on the Windows VM).
 */
export function killStaleE2EProcesses(): void {
  try {
    cp.execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        // Orphan webpack --watch node processes from prior debug sessions...
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'webpack' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" +
          // ...and orphan debug/verify browsers spawned under our e2e profile dirs.
          "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'dvpt-e2e-browser|webresource-debug-profile' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { encoding: "utf8" },
    );
  } catch {
    /* best effort */
  }
}

/** GET a JSON endpoint with a hard timeout, so probing a non-CDP listening port fails fast rather
 *  than hanging the scan. */
function httpGetJson(port: number, pathname: string, timeoutMs = 1000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname, timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/** Local TCP ports in LISTENING state, via `netstat` (a lightweight native command — unlike WMI/CIM
 *  it stays reliable under the e2e's heavy load, where a CIM query intermittently just fails). Uses
 *  the absolute path: the ExTester-spawned test process has a trimmed PATH that may not include
 *  System32, so a bare "netstat" throws ENOENT and finds nothing. */
function listeningPorts(): number[] {
  const ports = new Set<number>();
  const sysRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  for (const exe of [`${sysRoot}\\System32\\netstat.exe`, "netstat"]) {
    try {
      const out = cp.execFileSync(exe, ["-ano", "-p", "tcp"], { encoding: "utf8", maxBuffer: 1024 * 1024 * 8 });
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^\s*TCP\s+(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d+)\s+\S+\s+LISTENING/i);
        if (m) {
          ports.add(Number(m[1]));
        }
      }
      if (ports.size > 0) {
        break;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return [...ports];
}

/**
 * Discover the remote-debugging port of the browser Debug Web Resources launched. The feature picks
 * a free port internally, so we rediscover it: scan listening ports for a CDP endpoint that is an
 * Edge/Chrome browser (not VS Code's own Electron) with a page on the org / AAD sign-in. This is
 * done over HTTP (CDP.Version/List) rather than by scanning process command lines with WMI/CIM,
 * which proved unreliable under load. `profileMatch` is kept for signature compat / logging only.
 */
export async function findDebugPortByProfile(profileMatch: string, timeoutMs = 90000, log?: (m: string) => void): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const port of listeningPorts()) {
      try {
        const ver = (await httpGetJson(port, "/json/version")) as { Browser?: string; "User-Agent"?: string };
        // Edge reports its brand as "Edg/<ver>" (no trailing 'e'); Chrome/Chromium as "Chrom…".
        const browser = ver.Browser ?? "";
        const ua = ver["User-Agent"] ?? "";
        // VS Code's own CDP endpoint is Electron (User-Agent contains Electron/Code) — skip it.
        if (!/Edg|Chrom/i.test(browser) || /Electron|VSCode|\bCode\//i.test(ua)) {
          continue;
        }
        const targets = (await httpGetJson(port, "/json/list")) as Array<{ type?: string; url?: string }>;
        if (Array.isArray(targets) && targets.some((t) => t.type === "page" && !!t.url && /^https?:/i.test(t.url))) {
          return port;
        }
      } catch {
        /* not a CDP endpoint — skip */
      }
    }
    if (Date.now() > deadline) {
      (log ?? (() => undefined))(`[debug] no CDP debug port found for "${profileMatch}" among ${listeningPorts().length} listening ports`);
      throw new Error(`Could not find a debug port for a browser using profile "${profileMatch}"`);
    }
    await sleep(1000);
  }
}

export interface AutoLoginOptions {
  username: string;
  password: string;
  /** Host of the org (e.g. "org1234.crm11.dynamics.com") — sign-in is done once we land here. */
  orgHost: string;
  timeoutMs?: number;
  log?: (message: string) => void;
}

interface PageState {
  host: string;
  email: boolean;
  pass: boolean;
  kmsi: boolean;
  err: string | null;
}

async function evalOn(client: CDP.Client, expression: string, awaitPromise = false): Promise<unknown> {
  const { result } = await client.Runtime.evaluate({ expression, awaitPromise, returnByValue: true });
  return result.value;
}

/**
 * Screenshot the BROWSER (the model-driven app), not the editor — the other half of the hot-reload story
 * and the only way to show a live form in the docs (#231). Written next to the VS Code frames so a page
 * can put the two side by side. Opt-in with DVPT_E2E_SHOTS, like every other capture.
 */
export async function captureBrowserShot(port: number, name: string): Promise<void> {
  if (process.env.DVPT_E2E_SHOTS !== "1") {
    return;
  }
  let client: CDP.Client | undefined;
  try {
    client = await CDP({ port });
    const { data } = await client.Page.captureScreenshot({ format: "png" });
    const dir = path.join(path.resolve(__dirname, "..", "..", ".."), "sandbox", "screenshots-out", "profiling");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.png`), data, "base64");
    console.log(`    [shot] ${name}.png (browser)`);
  } catch (error) {
    console.log(`    [shot] ${name} (browser) failed: ${String(error).slice(0, 120)}`);
  } finally {
    try {
      await client?.close();
    } catch {
      /* ignore */
    }
  }
}

async function probe(client: CDP.Client): Promise<PageState> {
  const json = (await evalOn(
    client,
    `JSON.stringify((() => { const q=s=>document.querySelector(s); const vis=e=>!!(e&&e.offsetParent!==null&&!e.disabled); const t=document.body?document.body.innerText:''; return {
      host: location.host,
      email: vis(q('input[name=loginfmt]')), pass: vis(q('input[name=passwd]')),
      kmsi: /stay signed in\\?/i.test(t)||!!q('#KmsiCheckboxField'),
      err: (q('#usernameError')||q('#passwordError')||q('.alert-error')||{}).innerText||null }; })())`,
  )) as string;
  return JSON.parse(json) as PageState;
}

/**
 * Fill a React-controlled input the way AAD's sign-in form expects: set the value through the
 * native HTMLInputElement setter (so React's value tracker sees the change) and fire input+change.
 * A bare `.value =` or CDP Input.insertText can be silently reverted by React.
 *
 * On a freshly-launched browser the field can still be hydrating, so React reverts the value right
 * after we set it — retry until it sticks (this is why a race between page-load and the first
 * keystroke otherwise wedges the whole sign-in at the email step).
 */
async function typeInto(client: CDP.Client, selector: string, text: string): Promise<boolean> {
  const sel = JSON.stringify(selector);
  const readValue = () => evalOn(client, `(() => { const e=document.querySelector(${sel}); return e?e.value:null; })()`);
  for (let attempt = 0; attempt < 8; attempt++) {
    // Focus + clear the field first.
    await evalOn(
      client,
      `(() => { const e=document.querySelector(${sel}); if(!e) return null; e.focus(); e.select&&e.select();
        const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        setter.call(e, ''); e.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`,
    );
    // Prefer REAL keystrokes via the DevTools Input domain — AAD's React form registers these the
    // same as a human typing, whereas a value set programmatically can be dropped if the field is
    // still hydrating under load (which wedged the whole sign-in at the email step).
    try {
      await client.Input.insertText({ text });
    } catch {
      /* Input domain unavailable — the native-setter fallback below still runs */
    }
    // Verify the value is STABLE (re-read after a beat) — only trust it if it persisted.
    await sleep(500);
    if ((await readValue()) === text) {
      return true;
    }
    // Fallback: native setter (covers cases where insertText didn't land).
    await evalOn(
      client,
      `(() => { const e=document.querySelector(${sel}); if(!e) return null; e.focus();
        const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        setter.call(e, ${JSON.stringify(text)});
        e.dispatchEvent(new Event('input',{bubbles:true}));
        e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`,
    );
    await sleep(500);
    if ((await readValue()) === text) {
      return true;
    }
  }
  return false;
}

/** Submit the current AAD step. A programmatic `.click()` on the Next button intermittently doesn't
 *  fire AAD's submit handler (the button is enabled and the field filled, yet nothing advances), so
 *  also send a REAL Enter keypress via the DevTools Input domain to the focused field — that goes
 *  THROUGH AAD's keydown handler (which assembles the request), so it's reliable AND does not hit
 *  the AADSTS90100 that a native `form.submit()` would. `fieldSelector` is re-focused first so Enter
 *  lands on the input. */
async function submitStep(client: CDP.Client, fieldSelector: string): Promise<void> {
  await evalOn(client, `(() => { const f=document.querySelector(${JSON.stringify(fieldSelector)}); if(f){f.focus();} return true; })()`);
  try {
    await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  } catch {
    /* Input domain not available — fall back to the button click below */
  }
  await evalOn(client, `(() => { const b=document.querySelector('#idSIButton9'); if(b&&!b.disabled){b.click();return true;} return false; })()`);
}

/**
 * Drive the managed AAD sign-in on the browser at `port` until it reaches the org. Returns true on
 * success (including when the profile is already signed in). Never throws on a login mis-step — it
 * retries within the timeout and returns false if stuck.
 */
export async function autoLoginBrowser(port: number, opts: AutoLoginOptions): Promise<boolean> {
  const log = opts.log ?? (() => undefined);
  const targets = await CDP.List({ port });
  const pages = targets.filter((t) => t.type === "page");
  const hostOf = (u: string): string => {
    try {
      return new URL(u).hostname;
    } catch {
      return "";
    }
  };
  const target = pages.find((t) => hostOf(t.url) === "login.microsoftonline.com" || hostOf(t.url) === opts.orgHost) || pages.find((t) => t.url.startsWith("http")) || pages[0];
  const client = await CDP({ port, target });
  try {
    await client.Runtime.enable();
    const deadline = Date.now() + (opts.timeoutMs ?? 90000);
    let lastSig = "";
    while (Date.now() < deadline) {
      const s = await probe(client);
      const sig = `${s.host}|e${s.email ? 1 : 0}|p${s.pass ? 1 : 0}|k${s.kmsi ? 1 : 0}`;
      if (sig !== lastSig) {
        log(`[auto-login] ${sig}${s.err ? ` err="${s.err.replace(/\s+/g, " ").slice(0, 40)}"` : ""}`);
        lastSig = sig;
      }
      if (s.host.includes(opts.orgHost)) {
        return true;
      }
      if (s.pass) {
        if (await typeInto(client, "input[name=passwd]", opts.password)) {
          await submitStep(client, "input[name=passwd]");
        }
        await sleep(2500);
        continue;
      }
      if (s.email) {
        if (await typeInto(client, "input[name=loginfmt]", opts.username)) {
          await submitStep(client, "input[name=loginfmt]");
        }
        await sleep(2500);
        continue;
      }
      if (s.kmsi) {
        await evalOn(client, `(() => { const b=document.querySelector('#idSIButton9'); if(b){b.click();return true;} return false; })()`); // "Stay signed in?" → Yes
        await sleep(2500);
        continue;
      }
      await sleep(1500);
    }
    // Timed out — dump exactly what the sign-in page looked like so a stall is diagnosable from the
    // log rather than guessed at (field values present? Next disabled? an AAD error banner?).
    try {
      const diag = await evalOn(
        client,
        `JSON.stringify((()=>{const q=s=>document.querySelector(s);const nb=q('#idSIButton9');const em=q('input[name=loginfmt]');const pw=q('input[name=passwd]');return{url:location.href.slice(0,110),title:document.title,heading:(q('[role=heading],h1,h2')||{}).innerText||'',emailFilled:!!(em&&em.value),passFilled:!!(pw&&pw.value),nextDisabled:nb?!!nb.disabled:null,nextText:nb?(nb.value||nb.innerText||'').slice(0,20):null,err:(q('#usernameError')||q('#passwordError')||q('.alert-error')||{}).innerText||null,body:(document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,200)};})())`,
      );
      log(`[auto-login] STALL DIAG ${String(diag)}`);
    } catch {
      /* ignore */
    }
    return false;
  } finally {
    await client.close();
  }
}

/** Re-navigate the browser's page to `url` and let it settle — used to clear a wedged AAD sign-in
 *  page (a freshly-launched browser occasionally swallows the first email submit) before retrying. */
export async function renavigate(port: number, url: string, settleMs = 6000): Promise<void> {
  const targets = await CDP.List({ port });
  const pages = targets.filter((t) => t.type === "page");
  const page = pages.find((t) => t.url.startsWith("http")) || pages[0];
  if (!page) {
    return;
  }
  const client = await CDP({ port, target: page });
  try {
    await client.Page.enable();
    await client.Page.navigate({ url });
    await sleep(settleMs);
  } finally {
    await client.close();
  }
}

/**
 * Sign the browser in, retrying on a wedged sign-in: a freshly-launched browser sometimes stalls at
 * the email step, so on failure we re-navigate to the org (fresh login) and try again. Returns true
 * once the browser reaches the org.
 */
export async function autoLoginWithRetry(port: number, orgUrl: string, opts: AutoLoginOptions, attempts = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (await autoLoginBrowser(port, opts)) {
      return true;
    }
    if (attempt < attempts) {
      (opts.log ?? (() => undefined))(`[auto-login] attempt ${attempt} stalled — re-navigating and retrying`);
      await renavigate(port, orgUrl);
    }
  }
  return false;
}

/**
 * Sign in using a FRESH browser per attempt: on failure, kill the browser and relaunch on a clean
 * profile rather than re-navigating the same one. A wedged AAD page can sit loading forever, so
 * re-navigating it doesn't recover — a brand-new browser does. Returns the signed-in browser (the
 * caller owns closing it) plus whether it reached the org.
 */
/** The device code from pac's own prompt, or undefined if it hasn't printed one yet. */
export function parseDeviceCode(output: string): string | undefined {
  // ">>> To finish signing in to pac, open https://login.microsoft.com/device and enter the code C4BTB5ESK"
  return /enter the code\s+([A-Z0-9]{6,})/i.exec(output ?? "")?.[1];
}

/**
 * Complete pac's DEVICE CODE sign-in in a browser.
 *
 * Under interactive auth there is no client secret, so `pac auth create` can only use the device-code
 * flow: it prints a code and blocks until a human enters it. That is correct behaviour, and it is why
 * PCF — the one component type whose Dataverse path goes through `pac` — could not be covered
 * unattended (#227). With an MFA-exempt account in a dedicated dev tenant, the flow is drivable: type
 * the code, sign in, confirm.
 */
export async function completeDeviceCodeLogin(
  exePath: string,
  profileDir: string,
  code: string,
  opts: { username: string; password: string; deviceUrl?: string; log?: (message: string) => void },
): Promise<boolean> {
  const log = opts.log ?? ((): void => undefined);
  const url = opts.deviceUrl ?? "https://login.microsoft.com/device";
  log(`[device-code] opening ${url} to enter ${code}`);
  const browser = await launchBrowser(exePath, profileDir, url, 45000);
  let client: CDP.Client | undefined;
  try {
    client = await CDP({ port: browser.port });
    await sleep(4000);
    // The code box is #otc on the device-login page. Set it through the value setter so the page's
    // framework sees the change (a raw .value assignment leaves its model empty and Next stays disabled).
    const entered = await (async (): Promise<boolean> => {
      const deadline = Date.now() + 90000;
      for (;;) {
        const ok = await evalOn(
          client!,
          `(() => { const el = document.querySelector('#otc') || document.querySelector('input[name=otc]');
             if (!el) { return false; }
             const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
             set.call(el, ${JSON.stringify(code)});
             el.dispatchEvent(new Event('input', { bubbles: true }));
             el.dispatchEvent(new Event('change', { bubbles: true }));
             const next = document.querySelector('#idSIButton9') || document.querySelector('input[type=submit]');
             if (next) { next.click(); }
             return true; })()`,
        );
        if (ok === true || Date.now() > deadline) {
          return ok === true;
        }
        await sleep(2000);
      }
    })();
    if (!entered) {
      log("[device-code] the code box never appeared");
      browser.kill();
      return false;
    }
    await sleep(5000);
    // The ordinary managed-AAD sequence, driven here rather than through autoLoginBrowser: that one
    // waits to land on the ORG host, which a device-code sign-in never does — it ends on a "you have
    // signed in to Power Platform CLI" page.
    const fill = async (selector: string, value: string): Promise<boolean> =>
      (await evalOn(
        client!,
        `(() => { const el = document.querySelector(${JSON.stringify(selector)});
           if (!el || el.offsetParent === null) { return false; }
           const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
           set.call(el, ${JSON.stringify(value)});
           el.dispatchEvent(new Event('input', { bubbles: true }));
           const b = document.querySelector('#idSIButton9') || document.querySelector('input[type=submit]');
           if (b) { b.click(); }
           return true; })()`,
      )) === true;

    for (const [selector, value, what] of [
      ["input[name=loginfmt]", opts.username, "username"],
      ["input[name=passwd]", opts.password, "password"],
    ] as const) {
      const deadline = Date.now() + 90000;
      let done = false;
      while (!done && Date.now() < deadline) {
        done = await fill(selector, value);
        if (!done) {
          await sleep(2000);
        }
      }
      log(`[device-code] ${what}: ${done ? "entered" : "field never appeared"}`);
    }

    // "Stay signed in?" and the final "you're signing in to Power Platform CLI — Continue".
    for (let attempt = 0; attempt < 8; attempt++) {
      await evalOn(
        client,
        `(() => { const b = document.querySelector('#idSIButton9') || document.querySelector('input[type=submit]');
           if (b && !b.disabled) { b.click(); return true; } return false; })()`,
      );
      await sleep(2500);
    }

    const pageText = String((await evalOn(client, "document.body ? document.body.innerText : ''")) ?? "");
    const signedIn = /signed in|you may now close|Power Platform/i.test(pageText);
    log(`[device-code] ${signedIn ? "confirmed" : `did not confirm — page said: ${pageText.slice(0, 160)}`}`);
    // Give pac a moment to notice the completed authorisation before the browser goes away.
    await sleep(8000);
    browser.kill();
    return signedIn;
  } catch (error) {
    log(`[device-code] failed: ${String(error).slice(0, 160)}`);
    try {
      browser.kill();
    } catch {
      /* ignore */
    }
    return false;
  } finally {
    try {
      await client?.close();
    } catch {
      /* ignore */
    }
  }
}

export async function signInFreshBrowser(
  exePath: string,
  profileDir: string,
  orgUrl: string,
  opts: AutoLoginOptions,
  attempts = 3,
): Promise<{ browser: LaunchedBrowser; signedIn: boolean }> {
  const log = opts.log ?? (() => undefined);
  let browser: LaunchedBrowser | undefined;
  let signedIn = false;
  for (let attempt = 1; attempt <= attempts && !signedIn; attempt++) {
    if (browser) {
      browser.kill();
      await sleep(3000);
    }
    fs.rmSync(profileDir, { recursive: true, force: true });
    log(`[auto-login] launching a fresh sign-in browser (attempt ${attempt}/${attempts})`);
    browser = await launchBrowser(exePath, profileDir, orgUrl);
    signedIn = await autoLoginBrowser(browser.port, opts);
    if (!signedIn) {
      log(`[auto-login] attempt ${attempt} did not reach the org`);
    }
  }
  return { browser: browser as LaunchedBrowser, signedIn };
}

/** Open a persistent CDP client on the app page with the service worker bypassed, so the form's
 *  bundle request hits the network where the debug feature's interception can see it (the UCI SW
 *  cache otherwise serves the bundle above the network layer). Keep the client open through the
 *  load — closing it reverts the bypass mid-navigation. */
async function openPageClient(port: number): Promise<CDP.Client> {
  const targets = await CDP.List({ port });
  const pages = targets.filter((t) => t.type === "page");
  const page = pages.find((t) => /dynamics|crm|main\.aspx/i.test(t.url)) || pages.find((t) => t.url.startsWith("http")) || pages[0];
  const client = await CDP({ port, target: page });
  await client.Page.enable();
  await client.Network.enable();
  await client.Runtime.enable();
  await client.Network.setBypassServiceWorker({ bypass: true });
  return client;
}

/** Build the innerText-matching expression for a set of expected banner substrings. */
function bannerExpr(patterns: string[]): string {
  const alt = patterns.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return `(document.body&&document.body.innerText.match(/${alt}/)||['(none)'])[0]`;
}

async function pollBanner(client: CDP.Client, patterns: string[], timeoutMs: number, want?: string): Promise<string> {
  const expr = bannerExpr(patterns);
  const deadline = Date.now() + timeoutMs;
  let last = "(none)";
  while (Date.now() < deadline) {
    const v = (await client.Runtime.evaluate({ expression: expr, returnByValue: true })).result.value as string;
    if (v && v !== "(none)") {
      last = v;
      if (!want || v.includes(want)) {
        return v;
      }
    }
    await sleep(3000);
  }
  return last;
}

/** Resolve the hosts the app needs from the TEST HOST — degraded VM DNS mid-run is a known
 *  failure mode (#106); surfacing it makes environmental failures self-identifying. */
export async function networkDiag(orgHost: string | undefined): Promise<string> {
  const dns = await import("dns");
  const hosts = ["login.microsoftonline.com", ...(orgHost ? [orgHost] : [])];
  const results: string[] = [];
  for (const host of hosts) {
    try {
      await dns.promises.resolve4(host);
      results.push(`${host}: ok`);
    } catch (error: any) {
      results.push(`${host}: DNS FAIL (${error?.code || error?.message || error})`);
    }
  }
  return results.join(", ");
}

/** Navigate the browser to the record form and return the onload notification banner it renders
 *  (or "(none)"). `patterns` are the banner substrings to look for; `want` optionally requires a
 *  specific one before returning. */
export async function bannerOnForm(port: number, recordUrl: string, patterns: string[], want?: string, timeoutMs = 90000, log?: (m: string) => void): Promise<string> {
  const client = await openPageClient(port);
  const diag = async () =>
    (
      await client.Runtime.evaluate({
        expression: `JSON.stringify((()=>{const perf=performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/library\\.js/i.test(n)).slice(0,3);return{url:location.href,ready:document.readyState,title:document.title,bundle:perf,hasXrm:typeof Xrm!=='undefined',bodyLen:(document.body?document.body.innerText.length:0)};})())`,
        returnByValue: true,
      })
    ).result.value as string;
  try {
    // The model-driven app occasionally comes up blank/hung on a navigation. A page stuck at
    // readyState "loading" has a wedged main-document request that a plain re-navigate won't
    // recover (#106) — stop loading and reset through about:blank between attempts.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        try {
          await client.Page.stopLoading();
          await client.Page.navigate({ url: "about:blank" });
          await sleep(1500);
        } catch {
          /* best-effort reset */
        }
      }
      await client.Page.navigate({ url: recordUrl });
      const banner = await pollBanner(client, patterns, attempt < 2 ? Math.min(timeoutMs, 60000) : timeoutMs, want);
      if (banner !== "(none)") {
        return banner;
      }
      if (log) {
        log(`[debug] no-banner diag (attempt ${attempt + 1}): ${await diag()}`);
      }
    }
    if (log) {
      const orgHost = (() => {
        try {
          return new URL(recordUrl).hostname;
        } catch {
          return undefined;
        }
      })();
      log(`[debug] network diag: ${await networkDiag(orgHost)}`);
    }
    return "(none)";
  } finally {
    await client.close();
  }
}

/** Read the banner after a hot-reload edit WITHOUT opening a bypass-toggling client — on Chrome that
 *  races the feature's own CDP session and can tear the debug session down. Give the feature's
 *  debounced fs.watch reload time to fire + settle first, then read read-only. */
export async function bannerAfterReload(port: number, patterns: string[], want: string, timeoutMs = 60000): Promise<string> {
  await sleep(9000);
  const targets = await CDP.List({ port });
  const pages = targets.filter((t) => t.type === "page");
  const page = pages.find((t) => /dynamics|crm|main\.aspx/i.test(t.url)) || pages[0];
  if (!page) {
    return "(none)";
  }
  const client = await CDP({ port, target: page });
  try {
    await client.Runtime.enable();
    return await pollBanner(client, patterns, timeoutMs, want);
  } finally {
    await client.close();
  }
}
