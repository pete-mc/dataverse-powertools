// Shared helpers for the live end-to-end UI suites. These drive the REAL extension
// UI (via ExTester/Selenium) against the live test environment, so they need the
// gitignored sandbox/.env credentials and self-skip when those are absent. They are
// intentionally NOT part of the CI `*.test.js` glob (they are `*.e2e.ts`) — run them
// locally before a release with `npm run test:e2e`.
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { VSBrowser, Workbench, InputBox, BottomBarPanel, Key, ModalDialog } from "vscode-extension-tester";

export const repoRoot = path.resolve(__dirname, "..", "..", "..");

export interface E2EEnv {
  url: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  solutionName: string;
  prefix: string;
  /** MFA-exempt interactive user for the browser sign-in in the comprehensive e2e (optional). */
  username?: string;
  password?: string;
}

/** Load credentials from the gitignored sandbox/.env. Returns undefined if incomplete. */
export function loadE2EEnv(): E2EEnv | undefined {
  const p = path.resolve(repoRoot, "sandbox", ".env");
  if (!fs.existsSync(p)) {
    return undefined;
  }
  const raw: Record<string, string> = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) {
      continue;
    }
    const i = t.indexOf("=");
    if (i > 0) {
      raw[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
  const env: E2EEnv = {
    url: raw.DVPT_TEST_URL ?? "",
    tenantId: raw.DVPT_TEST_TENANT_ID ?? "",
    clientId: raw.DVPT_TEST_CLIENT_ID ?? "",
    clientSecret: raw.DVPT_TEST_CLIENT_SECRET ?? "",
    solutionName: raw.DVPT_TEST_SOLUTION_NAME || "dvpttests",
    prefix: raw.DVPT_TEST_PREFIX || "dvpt",
    username: raw.DVPT_TEST_USERNAME || process.env.DVPT_TEST_USERNAME || undefined,
    password: raw.DVPT_TEST_PASSWORD || process.env.DVPT_TEST_PASSWORD || undefined,
  };
  if (!env.url || !env.tenantId || !env.clientId || !env.clientSecret) {
    return undefined;
  }
  return env;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Remove onboarding/notification/modal overlays that intercept clicks. */
export async function dismissOverlays(): Promise<void> {
  try {
    await VSBrowser.instance.driver.executeScript(
      "for (const s of ['.onboarding-a-overlay','.monaco-dialog-box','.monaco-dialog-modal-block','.notifications-toasts','.notification-toast']) { document.querySelectorAll(s).forEach(function(e){ e.remove(); }); }",
    );
  } catch {
    /* ignore */
  }
  await sleep(300);
}

/**
 * Answer the next wizard step. If a quick pick is showing, select by label (when
 * `byLabel`) or the first item; otherwise type `value` into the input box and confirm.
 */
// Poll for the next input box to appear. During long steps (npm/paket restore,
// typings) there is no input box for minutes, and InputBox.create doesn't reliably
// honour a long timeout, so retry until one appears or the deadline passes.
async function waitForInput(timeoutMs: number): Promise<InputBox> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await InputBox.create(3000);
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`No input box appeared within ${timeoutMs}ms.`);
      }
      await sleep(1500);
    }
  }
}

/** Type into the next text input box (with read-back retry to survive focus glitches). */
export async function answerText(value: string, timeoutMs = 30000): Promise<void> {
  const input = await waitForInput(timeoutMs);
  for (let attempt = 0; attempt < 4; attempt++) {
    await input.setText(value);
    await sleep(400);
    let current = "";
    try {
      current = await input.getText();
    } catch {
      current = "";
    }
    if (current === value) {
      break;
    }
  }
  await input.confirm();
  await sleep(2500);
}

// Wait for a quick pick's items to populate (they may load from a live Dataverse query).
async function waitForPicks(input: InputBox, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let count = 0;
    try {
      count = (await input.getQuickPicks()).length;
    } catch {
      count = 0;
    }
    if (count > 0 || Date.now() > deadline) {
      return count;
    }
    await sleep(1000);
  }
}

/** Select a quick-pick item by its visible label (proven ExTester call). */
export async function pickByLabel(label: string, timeoutMs = 30000): Promise<void> {
  const input = await waitForInput(timeoutMs);
  await waitForPicks(input, Math.min(timeoutMs, 30000));
  try {
    await input.selectQuickPick(label);
  } catch (err) {
    // A coordinate click on a quick-pick row can be intercepted by the empty-editor
    // watermark <p> when the target row isn't first (ElementClickInterceptedError) —
    // e.g. picking "Plugins" after "Multi-component project" was floated to the top.
    // Fall back to type-to-filter + Enter, which can't be intercepted.
    await input.setText(label);
    await sleep(800);
    await input.confirm();
  }
  await sleep(2500);
}

/** Select a quick-pick item by an EXACT label match (filters first, then picks the item whose
 *  label equals `label`). Needed for the table step, where "account" is a substring of many
 *  logical names and a loose matcher could pick "accountleads" etc. */
export async function pickExactLabel(label: string, timeoutMs = 30000): Promise<void> {
  const input = await waitForInput(timeoutMs);
  await waitForPicks(input, Math.min(timeoutMs, 30000));
  try {
    await input.setText(label);
    await sleep(1500);
  } catch {
    /* some pickers don't accept typing; fall through to enumeration */
  }
  const picks = await input.getQuickPicks();
  for (const p of picks) {
    const l = await p.getLabel().catch(() => "");
    if (l === label) {
      await p.select();
      await sleep(2500);
      return;
    }
  }
  await input.selectQuickPick(label); // fallback to ExTester's matcher
  await sleep(2500);
}

/** Select the first quick-pick item (order-agnostic; for "any valid choice" steps). */
export async function pickFirst(timeoutMs = 30000): Promise<void> {
  const input = await waitForInput(timeoutMs);
  await waitForPicks(input, Math.min(timeoutMs, 30000));
  await input.selectQuickPick(0);
  await sleep(2500);
}

/** Current byte length of the mirrored extension-output log file (a stable baseline to search
 *  AFTER, so `waitForLogFile` never matches a stale line from an earlier step). 0 if unset/missing. */
export function logFileSize(): number {
  const p = process.env.DVPT_TEST_LOG_FILE;
  try {
    return p && fs.existsSync(p) ? fs.statSync(p).size : 0;
  } catch {
    return 0;
  }
}

/**
 * Wait for the extension's own log line to appear in the mirrored output FILE (`DVPT_TEST_LOG_FILE`,
 * written via appendFileSync in context.ts). This is a pure FILESYSTEM poll — no Selenium — so it's
 * safe to run for long stretches where driving the WebDriver would be risky. The profiler capture is
 * exactly that case: after "Profile next run" the extension enables profiling (net48 tool) then shows
 * a blocking modal; polling the WebDriver across that window loses the session on the 8GB VM
 * ("invalid session id"), whereas gating on the log line "[Profiler] Started profiling" doesn't touch
 * the driver at all. Search only bytes appended after `sinceByte`. Returns the matched tail.
 */
export async function waitForLogFile(needle: string | RegExp, opts: { timeoutMs?: number; sinceByte?: number } = {}): Promise<string> {
  const p = process.env.DVPT_TEST_LOG_FILE;
  if (!p) {
    throw new Error("DVPT_TEST_LOG_FILE is not set — cannot gate on the extension log file (run via scripts/runE2E.mjs).");
  }
  const timeoutMs = opts.timeoutMs ?? 120000;
  const since = opts.sinceByte ?? 0;
  const matches = (t: string) => (typeof needle === "string" ? t.includes(needle) : needle.test(t));
  const deadline = Date.now() + timeoutMs;
  let tail = "";
  for (;;) {
    try {
      tail = fs.existsSync(p) ? fs.readFileSync(p, "utf8").slice(since) : "";
    } catch {
      /* the extension is mid-append; retry */
    }
    if (tail && matches(tail)) {
      return tail;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${needle} in the extension log file.\n--- tail ---\n${tail.split(/\r?\n/).slice(-15).join("\n")}`,
      );
    }
    await sleep(2000);
  }
}

/**
 * Dismiss a VS Code MODAL message dialog (`showInformationMessage(..., { modal: true }, label)`) by
 * pressing its `label` button. Bounded retries via ExTester's ModalDialog, then a keyboard-ENTER
 * fallback — the modal's primary (custom) button is the default, so Enter activates it even when
 * ExTester's ModalDialog selector doesn't match the running VS Code build. Call this only once the
 * modal is known to be up (e.g. after `waitForLogFile` confirms it) so the retries stay short.
 */
export async function pushModalButton(label: string, opts: { attempts?: number } = {}): Promise<void> {
  const attempts = opts.attempts ?? 3;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await new ModalDialog().pushButton(label);
      await sleep(1500);
      return;
    } catch (err) {
      lastErr = err;
      await sleep(1500);
    }
  }
  // Fallback: activate the modal's default button with Enter (no element lookup).
  try {
    await new Workbench().getDriver().actions().sendKeys(Key.ENTER).perform();
    await sleep(1500);
  } catch {
    throw lastErr;
  }
}

/**
 * Select one item (by label substring) in a canPickMany quick-pick and confirm. The profiler
 * download picker (`Download which captured profiles?`) is multi-select, so a plain
 * selectQuickPick only TOGGLES the checkbox — the selection must then be confirmed with Enter.
 */
export async function pickManyByLabel(label: string, timeoutMs = 30000): Promise<void> {
  const input = await waitForInput(timeoutMs);
  await waitForPicks(input, Math.min(timeoutMs, 30000));
  // Filter to the target row(s), then CHECK them. A per-item `.select()` can go stale between
  // getQuickPicks() and the click (the list re-renders as it filters), so prefer toggleAllQuickPicks
  // (checks every filtered row) with a keyboard Space fallback (toggles the focused row) — robust for
  // the single filtered profile the download picker shows.
  await input.setText(label);
  await sleep(1500);
  await waitForPicks(input, 15000);
  let checked = false;
  try {
    await input.toggleAllQuickPicks(true);
    checked = true;
  } catch {
    /* older/edge InputBox — fall through to keyboard */
  }
  if (!checked) {
    try {
      await input.getDriver().actions().sendKeys(Key.SPACE).perform();
    } catch {
      /* best-effort */
    }
  }
  await sleep(700);
  await input.confirm(); // Enter accepts the checked items
  await sleep(2500);
}

/** Normalise a Dataverse org url for comparison (strip trailing slash, lowercase). */
function normalizeUrl(u: string): string {
  return u.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Select the quick-pick item that matches `value` by label OR description. The
 * environment step labels items by friendly name ("Peter McDonald's Environment")
 * and puts the org url in the *description*, so selecting by the url — which is all
 * the test knows — must look at the description, not just the label (ExTester's
 * selectQuickPick matches labels). Falls back to a label match, then the first item.
 */
async function selectPickMatching(input: InputBox, value: string): Promise<boolean> {
  const target = normalizeUrl(value);
  const picks = await input.getQuickPicks();
  for (const p of picks) {
    let label = "";
    let desc = "";
    try {
      label = await p.getLabel();
    } catch {
      label = "";
    }
    try {
      desc = (await p.getDescription()) ?? "";
    } catch {
      desc = "";
    }
    const nd = normalizeUrl(desc);
    const descMatch = nd.length > 0 && (nd === target || nd.includes(target) || target.includes(nd));
    const labelMatch = normalizeUrl(label) === target || label === value;
    if (descMatch || labelMatch) {
      await p.select();
      return true;
    }
  }
  // Fallbacks: ExTester's own label matcher, then the first item.
  try {
    await input.selectQuickPick(value);
    return true;
  } catch {
    if (picks.length > 0) {
      await picks[0].select();
      return true;
    }
  }
  return false;
}

/**
 * Answer a step that may be EITHER a quick pick or a text input. The wizard's
 * environment step, for example, is a quick pick when Global Discovery returns
 * environments but a manual-URL text box when it doesn't (app-only discovery often
 * sees none). Waits briefly to see if picks populate, then chooses the right action.
 */
export async function answerFlexible(value: string, timeoutMs = 30000): Promise<void> {
  const input = await waitForInput(timeoutMs);
  // Global Discovery is a network round-trip; give the picks room to populate before
  // deciding this is the manual-url text box.
  const pickCount = await waitForPicks(input, 10000);
  if (pickCount > 0) {
    await selectPickMatching(input, value);
  } else {
    for (let attempt = 0; attempt < 4; attempt++) {
      await input.setText(value);
      await sleep(400);
      let current = "";
      try {
        current = await input.getText();
      } catch {
        current = "";
      }
      if (current === value) {
        break;
      }
    }
    await input.confirm();
  }
  await sleep(2500);
}

/** Back-compat shim: quick pick when byLabel, else text input. */
export async function answer(value: string, byLabel = false, timeoutMs = 30000): Promise<void> {
  if (byLabel) {
    await pickByLabel(value, timeoutMs);
  } else {
    await answerText(value, timeoutMs);
  }
}

/** Run a command by its palette title (e.g. "Dataverse PowerTools: Generate Typings"). */
export async function runCommand(title: string): Promise<void> {
  await new Workbench().executeCommand(title);
}

/** Reclaim keyboard focus to the VS Code window. A long Web-API poll between UI
 * steps (or a heavy op's toasts) can leave the window without focus, so the
 * command-palette keystroke lands nowhere and executeCommand times out
 * ("element not visible"). Clicking the editor part (neutral chrome — triggers
 * nothing) restores focus. */
async function focusWorkbench(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { By } = require("vscode-extension-tester");
  const driver = new Workbench().getDriver();
  for (const selector of [".monaco-workbench .part.editor", ".monaco-workbench .part.sidebar", ".monaco-workbench"]) {
    try {
      const element = await driver.findElement(By.css(selector));
      await element.click();
      return;
    } catch {
      /* try the next anchor */
    }
  }
}

/**
 * Run a command, surviving a lost-focus window or a notification/toast that
 * intercepts the command palette (ExTester's executeCommand throws "element not
 * visible" then). Reclaims focus, dismisses overlays, and retries.
 */
export async function runCommandResilient(title: string, attempts = 4): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      try {
        await new Workbench().getDriver().actions().sendKeys(Key.ESCAPE).perform();
      } catch {
        /* ignore */
      }
      await focusWorkbench();
      await dismissOverlays();
      await new Workbench().executeCommand(title);
      return;
    } catch (err) {
      if (attempt === attempts - 1) {
        throw err;
      }
      await sleep(4000);
    }
  }
}

/**
 * Poll the "dataverse-powertools" output channel until every expected string is present (or
 * timeout). Used to gate each UI step on the command's REAL log output before advancing to the
 * next — so the test only proceeds once the extension reports the step actually succeeded.
 * Returns the channel text on success, or undefined on timeout.
 */
export async function waitForOutput(expected: string | string[], timeoutMs = 120000, channel = "dataverse-powertools"): Promise<string | undefined> {
  const wants = Array.isArray(expected) ? expected : [expected];
  let view;
  try {
    view = await new BottomBarPanel().openOutputView();
  } catch {
    return undefined;
  }
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    let text = "";
    try {
      await view.selectChannel(channel);
      text = await view.getText();
    } catch {
      // The output view churns while a long command runs; just retry.
    }
    if (text && wants.every((w) => text.includes(w))) {
      return text;
    }
    await sleep(2500);
  }
  return undefined;
}

/** Markers that mean the extension reported a failure — seeing any of these means STOP, don't wait. */
const DEFAULT_FAIL_MARKERS = ["Error creating", "Exception", "Unhandled", "Traceback", "npm error", "MSBuild error", "failed with exit code", "Could not obtain"];

/**
 * Gate a UI step on its REAL log output, failing fast when it's wrong.
 *
 * Polls the "dataverse-powertools" output channel and:
 *  - RESOLVES with the channel text once every `expected` string is present;
 *  - THROWS immediately if a failure marker appears before the expected output (so a wrong result
 *    stops the test right away instead of burning the whole timeout);
 *  - THROWS on timeout, with a tail of what the channel actually showed for diagnosis.
 *
 * This is the enforcement of "wait for the output you expect and if it is wrong, stop" — callers
 * `await expectOutput(...)` between steps and a mismatch aborts the run rather than silently advancing.
 */
export async function expectOutput(expected: string | string[], opts: { timeoutMs?: number; failMarkers?: string[]; channel?: string; step?: string } = {}): Promise<string> {
  const wants = Array.isArray(expected) ? expected : [expected];
  const timeoutMs = opts.timeoutMs ?? 120000;
  const failMarkers = opts.failMarkers ?? DEFAULT_FAIL_MARKERS;
  const channel = opts.channel ?? "dataverse-powertools";
  const label = opts.step ? `[${opts.step}] ` : "";
  const tail = (t: string) => t.split(/\r?\n/).slice(-25).join("\n");

  let view;
  try {
    view = await new BottomBarPanel().openOutputView();
  } catch (e) {
    throw new Error(`${label}could not open the output view to read "${wants.join(" & ")}": ${String(e)}`);
  }
  const start = Date.now();
  let lastText = "";
  while (Date.now() - start <= timeoutMs) {
    try {
      await view.selectChannel(channel);
      lastText = await view.getText();
    } catch {
      // The output view churns while a long command runs; just retry.
    }
    if (lastText) {
      if (wants.every((w) => lastText.includes(w))) {
        return lastText;
      }
      const hit = failMarkers.find((m) => lastText.includes(m));
      if (hit) {
        throw new Error(`${label}expected output "${wants.join(" & ")}" but the log reported a failure ("${hit}").\n--- log tail ---\n${tail(lastText)}`);
      }
    }
    await sleep(2500);
  }
  throw new Error(`${label}timed out after ${Math.round(timeoutMs / 1000)}s waiting for "${wants.join(" & ")}".\n--- log tail ---\n${tail(lastText) || "(channel was empty)"}`);
}

/** Clear the output channel so the next step's assertions don't match stale text. */
export async function clearOutput(): Promise<void> {
  try {
    const view = await new BottomBarPanel().openOutputView();
    await view.clearText();
  } catch {
    /* best effort */
  }
}

/** Poll until `filePath` exists (or timeout). Returns true if it appeared. */
export async function waitForFile(filePath: string, timeoutMs: number, intervalMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    if (fs.existsSync(filePath)) {
      return true;
    }
    await sleep(intervalMs);
  }
  return fs.existsSync(filePath);
}

/**
 * Wipe and recreate a clean workspace directory for an e2e project.
 *
 * MUST live outside this repo tree. A webresource project has no package.json, so
 * `npm install` walks up the directory tree looking for one; nested under the repo it
 * finds the repo's own package.json and installs into the repo's node_modules instead
 * of the project's — so the project's local deps never appear and the webpack build
 * can't resolve them. Using the OS temp dir isolates the project (test/live does the
 * same, via os.tmpdir()).
 */
export function freshWorkspace(name: string): string {
  const base = path.join(os.tmpdir(), "dvpt-e2e");
  let dir = path.join(base, name);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // A previous run's process (webpack --watch, a browser) may still hold a lock on the dir as it
    // shuts down — EPERM. Rather than fail the whole suite in its before-hook, fall back to a
    // uniquely-suffixed workspace so a back-to-back re-run isn't blocked.
    dir = path.join(base, `${name}-${process.pid}-${Date.now()}`);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- Minimal Dataverse Web API client (verify + cleanup, independent of the extension) ----
const API_VERSION = "api/data/v9.2";

export class E2EClient {
  private token = "";
  constructor(private readonly env: E2EEnv) {}

  async connect(): Promise<void> {
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", this.env.clientId);
    params.append("client_secret", this.env.clientSecret);
    params.append("resource", this.env.url);
    const res = await fetch(`https://login.microsoftonline.com/${this.env.tenantId}/oauth2/token`, {
      method: "POST",
      body: params,
    });
    const data: any = await res.json();
    if (!data?.access_token) {
      throw new Error(`Token request failed: ${data?.error_description ?? data?.error ?? "unknown"}`);
    }
    this.token = data.access_token;
  }

  private async request(method: string, resourcePath: string, body?: unknown): Promise<Response> {
    /* eslint-disable @typescript-eslint/naming-convention */
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    const url = `${this.env.url.replace(/\/+$/, "")}/${API_VERSION}/${resourcePath}`;
    // Retry transient connection resets (write ECONNRESET etc.) so a network blip in
    // the before-hook solution lookup doesn't fail the whole suite.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await fetch(url, init);
      } catch (err) {
        lastErr = err;
        await sleep(1000 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  /** The friendly (display) name for a solution's unique name — the wizard lists solutions by friendly name. */
  async getSolutionFriendlyName(uniqueName: string): Promise<string | undefined> {
    const res = await this.request("GET", `solutions?$select=friendlyname&$filter=uniquename eq '${uniqueName.replace(/'/g, "''")}'`);
    if (!res.ok) {
      return undefined;
    }
    const data: any = await res.json();
    return data.value?.[0]?.friendlyname;
  }

  async findWebresourceId(name: string): Promise<string | undefined> {
    const res = await this.request("GET", `webresourceset?$select=webresourceid&$filter=name eq '${name.replace(/'/g, "''")}'`);
    if (!res.ok) {
      return undefined;
    }
    const data: any = await res.json();
    return data.value?.[0]?.webresourceid;
  }

  async deleteWebresource(name: string): Promise<void> {
    const id = await this.findWebresourceId(name);
    if (id) {
      await this.request("DELETE", `webresourceset(${id})`);
    }
  }

  /** The DEPLOYED JavaScript of a webresource (base64-decoded), or undefined. */
  async getWebresourceContent(name: string): Promise<string | undefined> {
    const res = await this.request("GET", `webresourceset?$select=content&$filter=name eq '${name.replace(/'/g, "''")}'`);
    if (!res.ok) {
      return undefined;
    }
    const data: any = await res.json();
    const content = data.value?.[0]?.content;
    return content ? Buffer.from(content, "base64").toString("utf8") : undefined;
  }

  async getFormXml(formId: string): Promise<string | undefined> {
    const res = await this.request("GET", `systemforms(${formId})?$select=formxml`);
    if (!res.ok) {
      return undefined;
    }
    return ((await res.json()) as any).formxml;
  }

  async getFormEntity(formId: string): Promise<string | undefined> {
    const res = await this.request("GET", `systemforms(${formId})?$select=objecttypecode`);
    return res.ok ? ((await res.json()) as any).objecttypecode : undefined;
  }

  /** Restore a form's XML (test cleanup) and publish the change. */
  async setFormXml(formId: string, formXml: string, entityLogicalName: string): Promise<void> {
    await this.request("PATCH", `systemforms(${formId})`, { formxml: formXml });
    // eslint-disable-next-line @typescript-eslint/naming-convention
    await this.request("POST", "PublishXml", { ParameterXml: `<importexportxml><entities><entity>${entityLogicalName}</entity></entities></importexportxml>` });
  }

  /** A model-driven app id to open forms in (deterministic form URLs need one). Prefers an app
   *  whose name contains "Sales"/"Customer Service"/"Hub"; falls back to the first app. */
  async getModelDrivenAppId(): Promise<string | undefined> {
    const res = await this.request("GET", `appmodules?$select=appmoduleid,name&$filter=statecode eq 0`);
    if (!res.ok) {
      return undefined;
    }
    const data: any = await res.json();
    const apps: any[] = data.value ?? [];
    const preferred = apps.find((a) => /sales|customer service|hub/i.test(a.name ?? ""));
    return (preferred ?? apps[0])?.appmoduleid;
  }

  /** The id of any existing record in an entity set (e.g. "accounts"), so a form opens on a real
   *  record — a create form triggers a beforeunload dialog on hot-reload. */
  async getFirstRecordId(entitySet: string, primaryIdField: string): Promise<string | undefined> {
    const res = await this.request("GET", `${entitySet}?$select=${primaryIdField}&$top=1`);
    if (!res.ok) {
      return undefined;
    }
    const data: any = await res.json();
    return data.value?.[0]?.[primaryIdField];
  }

  async findPluginPackageId(uniqueName: string): Promise<string | undefined> {
    const res = await this.request("GET", `pluginpackages?$select=pluginpackageid&$filter=uniquename eq '${uniqueName.replace(/'/g, "''")}'`);
    if (!res.ok) {
      return undefined;
    }
    const data: any = await res.json();
    return data.value?.[0]?.pluginpackageid;
  }

  /** Create a throwaway territory row — reliably triggers Create-of-territory
   * steps (an org may have zero existing territories to update). Returns the id. */
  async createTerritory(): Promise<string | undefined> {
    const res = await this.request("POST", "territories", { name: `E2E profiler ${Date.now()}` });
    if (res.status !== 204 && res.status !== 201) {
      return undefined;
    }
    return res.headers.get("odata-entityid")?.match(/\(([0-9a-f-]{36})\)/i)?.[1];
  }

  async deleteTerritory(id: string): Promise<void> {
    await this.request("DELETE", `territories(${id})`);
  }

  /** Count active, plugin (non-system) steps for an assembly, using the SAME server-side assembly
   * filter the extension's getProfilableSteps now applies. Proves a freshly-deployed step is
   * discoverable as profilable even in a busy org (the $top=200 system-step flood fix). */
  async profilableStepCount(assemblyName: string): Promise<number> {
    const filter = `statecode eq 0 and _plugintypeid_value ne null and plugintypeid/pluginassemblyid/name eq '${assemblyName.replace(/'/g, "''")}'`;
    const res = await this.request("GET", `sdkmessageprocessingsteps?$select=name&$filter=${filter}&$top=50`);
    if (!res.ok) {
      return 0;
    }
    return ((await res.json()) as { value?: unknown[] }).value?.length ?? 0;
  }

  /**
   * Delete any Plugin Profiler steps left on an entity's messages by an interrupted capture — the
   * profiler's own clone step (plugin type `PluginProfiler.Plugins.ProfilerPlugin`, name "… (Profiler)")
   * plus the disabled original ("… (Profiled)"). If a capture doesn't reach "Stop Profiling", that
   * clone keeps firing on the entity and every create/update on it then 400s with "Unexpected
   * Exception in the Plug-in Profiler" (its target assembly may already be gone). Cleanup calls this
   * so a failed run never leaves the shared org broken. Returns the number of steps deleted.
   */
  async cleanupProfilerSteps(entityLogicalName: string): Promise<number> {
    const filter = `sdkmessagefilterid/primaryobjecttypecode eq '${entityLogicalName.replace(/'/g, "''")}'`;
    const res = await this.request("GET", `sdkmessageprocessingsteps?$select=name,sdkmessageprocessingstepid&$expand=plugintypeid($select=typename)&$filter=${filter}`);
    if (!res.ok) {
      return 0;
    }
    const rows: any[] = ((await res.json()) as any).value ?? [];
    let deleted = 0;
    for (const s of rows) {
      const typeName = (s.plugintypeid?.typename as string) ?? "";
      const name = (s.name as string) ?? "";
      if (/ProfilerPlugin/.test(typeName) || /\((Profiler|Profiled)\)\s*$/.test(name)) {
        const del = await this.request("DELETE", `sdkmessageprocessingsteps(${s.sdkmessageprocessingstepid})`);
        if (del.ok || del.status === 204) {
          deleted++;
        }
      }
    }
    return deleted;
  }

  /** Whether a persisted plug-in profile exists for the given type name. */
  async hasPluginProfileForType(typeName: string): Promise<boolean> {
    const res = await this.request("GET", `mbs_pluginprofiles?$select=mbs_pluginprofileid&$filter=mbs_typename eq '${typeName.replace(/'/g, "''")}'&$top=1`);
    if (!res.ok) {
      return false;
    }
    return (((await res.json()) as any).value?.length ?? 0) > 0;
  }

  async deletePluginPackage(uniqueName: string): Promise<void> {
    const id = await this.findPluginPackageId(uniqueName);
    if (id) {
      await this.request("DELETE", `pluginpackages(${id})`);
    }
  }
}

/**
 * Reset ALL credentials — pac auth profiles (host-side `pac auth clear`) and the
 * extension's stored secrets/token cache (via the Clear Stored Credentials
 * command, which also runs pac auth clear in-extension; the host-side clear is
 * kept as a belt-and-braces for runs where the extension isn't active yet).
 * Every suite calls this before its wizard so each auth type proves its FULL
 * path from zero — service-principal leftovers masked the OAuth
 * no-active-environment bug, and this prevents the reverse too. The seeded
 * MSAL test cache FILE is untouched (the launcher owns it; interactive suites
 * re-read it).
 */
export async function resetAllCredentials(log?: (m: string) => void): Promise<void> {
  const cp = await import("child_process");
  const { pacInvocation } = await import("../../general/pac");
  const { command, args } = pacInvocation(["auth", "clear"]);
  const result = cp.spawnSync(command, args, { encoding: "utf8", timeout: 60000 });
  if (log) {
    log(`[reset] pac auth clear -> exit ${result.status}`);
  }
  try {
    await runCommand("Dataverse PowerTools: Clear Stored Credentials");
    await sleep(2000);
    if (log) {
      log("[reset] extension credentials cleared");
    }
  } catch {
    if (log) {
      log("[reset] Clear Stored Credentials command unavailable (extension not active yet) — pac cleared host-side");
    }
  }
}

/**
 * Breakpoint-binding parity check (user request): the built bundle's inline
 * source map must contain the class's source under a name our attach config's
 * sourceMapPathOverrides actually match — the exact mismatch that shipped as
 * "unbound breakpoints". Throws with the real source names on failure.
 */
export function assertSourceMapBindsBreakpoints(builtBundlePath: string, componentRoot: string, prefix: string, classFileName: string): void {
  // Compiled e2e code lives in out/ui-test/e2e; the compiled extension modules in out/.

  const { buildAttachDebugConfig, anyOverrideMatches } = require("../../webresources/debug/debugConfig");
  const code = fs.readFileSync(builtBundlePath, "utf8");
  const match = code.match(/\/\/# sourceMappingURL=data:application\/json[^,]*,([A-Za-z0-9+/=]+)/);
  if (!match) {
    throw new Error(`${path.basename(builtBundlePath)} has no inline source map — webpack.dev.js devtool drifted from inline-source-map (breakpoints cannot bind).`);
  }
  const sources: string[] = JSON.parse(Buffer.from(match[1], "base64").toString("utf8")).sources ?? [];
  const classSource = sources.find((source) => source.includes(`webresources_src/${classFileName}`));
  if (!classSource) {
    throw new Error(`Source map does not carry webresources_src/${classFileName}. Sources: ${sources.slice(0, 10).join(", ")}`);
  }
  const config = buildAttachDebugConfig("edge", 9222, componentRoot, prefix);
  if (!anyOverrideMatches(config.sourceMapPathOverrides, classSource)) {
    throw new Error(
      `sourceMapPathOverrides do not match the bundle's actual source name '${classSource}' — breakpoints would be UNBOUND. Overrides: ${Object.keys(config.sourceMapPathOverrides ?? {}).join(" | ")}`,
    );
  }
}

/** Extra Web API helpers for the profiler-replay chain (#114). */
export interface E2EProfilerHelpers {
  touchFirstTerritory(): Promise<boolean>;
  hasPluginProfileForType(typeName: string): Promise<boolean>;
}
