/* eslint-disable @typescript-eslint/naming-convention */
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import * as cp from "child_process";
import CDP = require("chrome-remote-interface");

// Unattended Azure AD sign-in for the test browser, driven over the DevTools Protocol.
// Lets the live/e2e harness exercise the interactive ("Authenticated") user path — and
// run Edge and Chrome with the same test account — without a human typing credentials.
//
// The account MUST be excluded from MFA/conditional access: this fills the managed AAD
// sign-in form (email → password → "stay signed in") and cannot satisfy an MFA challenge.
// Credentials come from DVPT_TEST_USERNAME / DVPT_TEST_PASSWORD via loadInteractiveTestUser().

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

/**
 * Read the CDP port a Chromium browser wrote to `<profileDir>/DevToolsActivePort`.
 * Chromium writes this file once its debugging endpoint is listening, so it's the
 * reliable way to learn the port when the launcher (e.g. Debug Web Resources) picked a
 * free one internally. First line is the port.
 */
export async function readDevToolsPort(profileDir: string, timeoutMs = 25000): Promise<number> {
  const file = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const first = fs.readFileSync(file, "utf8").split(/\r?\n/)[0]?.trim();
      const port = Number(first);
      if (port > 0) {
        return port;
      }
    } catch {
      /* not written yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`DevToolsActivePort not found under ${profileDir} within ${timeoutMs}ms`);
    }
    await sleep(300);
  }
}

/**
 * Discover the remote-debugging port of the browser launched with `--user-data-dir=profileDir`.
 * Chromium only writes `DevToolsActivePort` when the port is 0 (auto-picked); when a launcher
 * passes an explicit port (as Debug Web Resources does), read it from the process command line.
 * Windows-only (this harness runs on the Windows VM), via PowerShell/CIM.
 */
export async function findDebugPortByProfile(profileDir: string, timeoutMs = 25000): Promise<number> {
  const script =
    `$p=$env:DVPT_PROFILE; ` +
    `$proc = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | ` +
    `Where-Object { $_.CommandLine -like "*$p*" -and $_.CommandLine -like '*remote-debugging-port=*' } | Select-Object -First 1; ` +
    `if ($proc -and $proc.CommandLine -match 'remote-debugging-port=(\\d+)') { $matches[1] }`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const out = cp.execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, DVPT_PROFILE: profileDir }, encoding: "utf8" }).trim();
      const port = Number(out);
      if (port > 0) {
        return port;
      }
    } catch {
      /* process not up yet */
    }
    if (Date.now() > deadline) {
      throw new Error(`Could not find a debug port for a browser using profile ${profileDir}`);
    }
    await sleep(400);
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
 * Fill a React-controlled input the way AAD's sign-in form expects: set the value through
 * the native HTMLInputElement setter (so React's value tracker sees the change) and fire
 * input+change. A bare `.value =` or CDP Input.insertText can be silently reverted by React.
 */
async function typeInto(client: CDP.Client, selector: string, text: string): Promise<boolean> {
  const val = await evalOn(
    client,
    `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return null;
      e.focus();
      const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      setter.call(e, ${JSON.stringify(text)});
      e.dispatchEvent(new Event('input',{bubbles:true}));
      e.dispatchEvent(new Event('change',{bubbles:true}));
      return e.value; })()`,
  );
  return val === text;
}

async function click(client: CDP.Client, selector: string): Promise<void> {
  await evalOn(client, `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(e){e.click();return true;} return false; })()`);
}

/**
 * Drive the managed AAD sign-in on the browser at `port` until it reaches the org.
 * Returns true on success (including when the profile is already signed in). Never
 * throws on a login mis-step — it retries within the timeout and returns false if stuck.
 */
export async function autoLoginBrowser(port: number, opts: AutoLoginOptions): Promise<boolean> {
  const log = opts.log ?? (() => undefined);
  // Explicitly attach to the sign-in (or org) page — the browser may have several page
  // targets and the default pick isn't always the login tab.
  const targets = await CDP.List({ port });
  const pages = targets.filter((t) => t.type === "page");
  const target = pages.find((t) => t.url.includes("login.microsoftonline.com") || t.url.includes(opts.orgHost)) || pages.find((t) => t.url.startsWith("http")) || pages[0];
  const client = await CDP({ port, target });
  try {
    await client.Runtime.enable();
    const deadline = Date.now() + (opts.timeoutMs ?? 90000);
    let lastSig = "";
    // Visibility-driven, not a fixed stage machine: whichever step is on screen, do it —
    // and keep re-doing it until the screen actually changes. A "Next"/"Sign in" click can
    // land before the button is armed, so retrying (rather than optimistically advancing) is
    // what makes this reliable across Edge and Chrome.
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
          await click(client, "#idSIButton9");
        }
        await sleep(2500);
        continue;
      }
      if (s.email) {
        if (await typeInto(client, "input[name=loginfmt]", opts.username)) {
          await click(client, "#idSIButton9");
        }
        await sleep(2500);
        continue;
      }
      if (s.kmsi) {
        await click(client, "#idSIButton9"); // "Stay signed in?" → Yes (persist the profile)
        await sleep(2500);
        continue;
      }
      await sleep(1500);
    }
    return false;
  } finally {
    await client.close();
  }
}

export interface PreAuthOptions {
  username: string;
  password: string;
  orgHost: string;
  log?: (message: string) => void;
}

/**
 * Sign a Chromium profile in ahead of time so a later Debug Web Resources session starts
 * already authenticated — the same state a real developer's persistent profile is in.
 * Launches its own clean browser (no interception attached), drives the AAD sign-in, lets
 * cookies flush, and closes it so the profile dir is free to reopen. Returns true on success.
 */
export async function preAuthenticateProfile(exePath: string, profileDir: string, orgUrl: string, opts: PreAuthOptions): Promise<boolean> {
  const log = opts.log ?? (() => undefined);
  fs.mkdirSync(profileDir, { recursive: true });
  const port = await freePort();
  const child = cp.spawn(exePath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", "--new-window", orgUrl], { stdio: "ignore" });
  try {
    const deadline = Date.now() + 25000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const c = await CDP({ port });
        await c.close();
        up = true;
        break;
      } catch {
        await sleep(400);
      }
    }
    if (!up) {
      log("[pre-auth] browser CDP endpoint never came up");
      return false;
    }
    const ok = await autoLoginBrowser(port, { username: opts.username, password: opts.password, orgHost: opts.orgHost, log });
    await sleep(3000); // let auth cookies flush to disk before we close
    return ok;
  } finally {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    await sleep(2000); // release the profile lock so the debug session can reopen it
  }
}
