// Shared helpers for the live end-to-end UI suites. These drive the REAL extension
// UI (via ExTester/Selenium) against the live test environment, so they need the
// gitignored sandbox/.env credentials and self-skip when those are absent. They are
// intentionally NOT part of the CI `*.test.js` glob (they are `*.e2e.ts`) — run them
// locally before a release with `npm run test:e2e`.
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { VSBrowser, Workbench, InputBox, BottomBarPanel } from "vscode-extension-tester";

export const repoRoot = path.resolve(__dirname, "..", "..", "..");

export interface E2EEnv {
  url: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  solutionName: string;
  prefix: string;
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
  await input.selectQuickPick(label);
  await sleep(2500);
}

/** Select the first quick-pick item (order-agnostic; for "any valid choice" steps). */
export async function pickFirst(timeoutMs = 30000): Promise<void> {
  const input = await waitForInput(timeoutMs);
  await waitForPicks(input, Math.min(timeoutMs, 30000));
  await input.selectQuickPick(0);
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
  const dir = path.join(os.tmpdir(), "dvpt-e2e", name);
  fs.rmSync(dir, { recursive: true, force: true });
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

  private async request(method: string, resourcePath: string): Promise<Response> {
    /* eslint-disable @typescript-eslint/naming-convention */
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
      },
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

  async findPluginPackageId(uniqueName: string): Promise<string | undefined> {
    const res = await this.request("GET", `pluginpackages?$select=pluginpackageid&$filter=uniquename eq '${uniqueName.replace(/'/g, "''")}'`);
    if (!res.ok) {
      return undefined;
    }
    const data: any = await res.json();
    return data.value?.[0]?.pluginpackageid;
  }

  async deletePluginPackage(uniqueName: string): Promise<void> {
    const id = await this.findPluginPackageId(uniqueName);
    if (id) {
      await this.request("DELETE", `pluginpackages(${id})`);
    }
  }
}
