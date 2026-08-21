// Shared helpers for the live end-to-end UI suites. These drive the REAL extension
// UI (via ExTester/Selenium) against the live test environment, so they need the
// gitignored sandbox/.env credentials and self-skip when those are absent. They are
// intentionally NOT part of the CI `*.test.js` glob (they are `*.e2e.ts`) — run them
// locally before a release with `npm run test:e2e`.
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { VSBrowser, Workbench, InputBox, BottomBarPanel, Key, ModalDialog } from "vscode-extension-tester";
// The SAME lookups the product uses. Keeping a second copy here is what let the product and the test
// agree on a wrong assumption about how Dataverse stores a name, so a working push read as broken.
import { customControlLookup, pluginTraceLogLookup, pickMatchingRow } from "../../general/dataverse/rowLookups";
import { scopedName, scopedIdentifier, profilerStepDisposition } from "./fixtureNames";

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

/**
 * A short id unique to this e2e RUN, shared by every suite in it (`DVPT_E2E_RUN_ID`, set by
 * scripts/runE2E.mjs).
 *
 * Suites create rows in ONE shared Dataverse environment under fixed names, so two runs at once — a CI
 * job and someone's VM, say — delete each other's fixtures and each sees the other's leftovers. Within a
 * single run the same trap already bit: every web-resource suite deploys `{prefix}_library.js`, so an
 * assertion that "the web resource exists" was satisfied by ANOTHER suite's row and proved nothing
 * (#249). Scope anything you create.
 */
export function runId(): string {
  return process.env.DVPT_E2E_RUN_ID || "local";
}

/** `base` with this run's id appended, for fixtures that live in the shared environment.
 * The rules live in fixtureNames.ts so they can be unit-tested outside an ExTester run (#258). */
export function runScopedName(base: string): string {
  return scopedName(base, runId());
}

/** As `runScopedName`, for a fixture whose name also has to compile as a C#/TypeScript
 * identifier — a plug-in project/namespace/class, or a web-resource class (#258). */
export function runScopedIdentifier(base: string): string {
  return scopedIdentifier(base, runId());
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

/**
 * Whether the open quick-input widget is a PICKER (a list, however empty) rather than a plain text
 * box. VS Code renders both through the same widget, and `getQuickPicks()` returns [] for both an
 * empty picker and a text box — so waiting for items cannot tell them apart, and waiting longer
 * makes a text box slower without ever succeeding.
 *
 * The list container is only rendered, and only visible, for a picker. That is the distinction.
 */
async function inputIsPicker(): Promise<boolean> {
  try {
    return Boolean(
      await VSBrowser.instance.driver.executeScript(
        "const l = document.querySelector('.quick-input-widget .quick-input-list'); if (!l) { return false; } const s = window.getComputedStyle(l); return s.display !== 'none' && s.visibility !== 'hidden' && l.getClientRects().length > 0;",
      ),
    );
  } catch {
    // If the probe itself fails, don't claim it's a text box — let the caller's normal wait decide.
    return true;
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

// ── Documentation screenshots (opt-in via DVPT_E2E_SHOTS=1) ──────────────────────────────────────
//
// The suites already click through every real step, so capturing the wiki's walkthrough frames HERE
// means the images are of the actual UI at the actual moment — a staged re-enactment would drift from
// the product the first time a label changed. Off by default so normal runs pay nothing.

const SHOTS_DIR = path.join(repoRoot, "sandbox", "screenshots-out", "profiling");

export function shotsEnabled(): boolean {
  return process.env.DVPT_E2E_SHOTS === "1";
}

/** The window size the e2e instance runs at; a side-by-side half is exactly half of it. */
export const E2E_WINDOW = { width: 1718, height: 872 };
export const SIDE_BY_SIDE_HALF = { width: Math.floor(E2E_WINDOW.width / 2), height: E2E_WINDOW.height };

/**
 * Resize the VS Code window to one half of the screen, for a capture that will be stitched next to a
 * browser frame — so the composed image reads as ONE screen rather than two overlapping full ones.
 * Returns a function that puts the window back.
 */
export async function shotEditorHalf(name: string): Promise<void> {
  if (!shotsEnabled()) {
    return;
  }
  try {
    await clearShotArtefacts(false);
    fs.mkdirSync(SHOTS_DIR, { recursive: true });

    const { PNG } = require("pngjs");
    const full = PNG.sync.read(Buffer.from(await VSBrowser.instance.driver.takeScreenshot(), "base64"));
    const width = Math.min(SIDE_BY_SIDE_HALF.width, full.width);
    // Crop from the LEFT. Taking the right half looked more "editor-ish" but cut every line of code
    // mid-statement; the left half keeps the line numbers, the start of each line, and the output panel
    // — which is what makes the hot-reload story readable next to the form.
    const left = 0;
    const half = new PNG({ width, height: full.height });
    for (let y = 0; y < full.height; y++) {
      for (let x = 0; x < width; x++) {
        const source = (full.width * y + (left + x)) << 2;
        const target = (width * y + x) << 2;
        half.data[target] = full.data[source];
        half.data[target + 1] = full.data[source + 1];
        half.data[target + 2] = full.data[source + 2];
        half.data[target + 3] = 255;
      }
    }
    fs.writeFileSync(path.join(SHOTS_DIR, `${name}.png`), PNG.sync.write(half));
    console.log(`    [shot] ${name}.png (editor half ${width}x${full.height})`);
  } catch (error) {
    console.log(`    [shot] ${name} (editor half) failed: ${String(error).slice(0, 120)}`);
  }
}

/**
 * Clear what an earlier step left visible in the MAIN document: every outline this module applied, the
 * focus ring on the last-clicked control, and any text selection. `keepOwnOutline` spares the outline
 * for the frame being captured right now.
 */
async function clearShotArtefacts(keepOwnOutline: boolean): Promise<void> {
  try {
    await VSBrowser.instance.driver.executeScript(
      `const keep = ${keepOwnOutline ? "true" : "false"};
       for (const el of document.querySelectorAll('[data-dvpt-shot]')) {
         if (keep && el.dataset.dvptShot === "current") { continue; }
         el.style.outline = "";
         el.style.outlineOffset = "";
         delete el.dataset.dvptShot;
       }
       if (!keep && document.activeElement && document.activeElement !== document.body) {
         try { document.activeElement.blur(); } catch (e) { /* some hosts refuse */ }
       }
       const selection = window.getSelection();
       if (selection && selection.rangeCount > 0) { selection.removeAllRanges(); }`,
    );
  } catch {
    /* best-effort: never fail a step over tidying a screenshot */
  }
}

/**
 * Full-window PNG named `<name>.png` (callers prefix a step number for stable ordering).
 *
 * Tidies the window first, because a frame should show only what THIS step is about. Three things
 * otherwise carry over and read as "these are highlighted too": an outline this module applied for an
 * earlier frame, the focus ring VS Code leaves on the last control that was clicked, and a live text
 * selection (reading the output pane leaves one behind).
 */
export async function shot(name: string): Promise<void> {
  if (!shotsEnabled()) {
    return;
  }
  try {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    await clearShotArtefacts(false);
    const png = await VSBrowser.instance.driver.takeScreenshot();
    fs.writeFileSync(path.join(SHOTS_DIR, `${name}.png`), png, "base64");
    console.log(`    [shot] ${name}.png`);
  } catch (error) {
    console.log(`    [shot] ${name} failed: ${String(error).slice(0, 120)}`);
  }
}

/**
 * Outline the first element matching `selector` in the MAIN document, snap, then un-outline — so each
 * documentation frame shows exactly which control, option or value the step uses. Quick picks, modals
 * and the debug toolbar all live in the main document; panel buttons live in the panel's webview and
 * are captured by `clickPanelButton`'s own `shot` option instead.
 */
export async function shotWithHighlight(selector: string, name: string, opts: { text?: string } = {}): Promise<void> {
  if (!shotsEnabled()) {
    return;
  }
  const driver = VSBrowser.instance.driver;
  try {
    // Clear first: an earlier frame's outline still on screen would make this one look like it
    // highlights two controls.
    await clearShotArtefacts(false);
    const applied = (await driver.executeScript(
      `const wanted = ${JSON.stringify(opts.text ?? "")};
       const all = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
       const el = wanted ? all.find((c) => (c.textContent || "").includes(wanted)) : all[0];
       if (!el) { return false; }
       el.dataset.dvptShot = "current";
       el.style.outline = "3px solid #f80";
       el.style.outlineOffset = "2px";
       el.scrollIntoView({ block: "center" });
       return true;`,
    )) as boolean;
    if (!applied) {
      console.log(`    [shot] ${name}: no element matched ${selector} — capturing without a highlight`);
    }
    await sleep(400);
    // Keep this frame's own outline; drop everything else (focus ring, selection, older outlines).
    await clearShotArtefacts(true);
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const png = await driver.takeScreenshot();
    fs.writeFileSync(path.join(SHOTS_DIR, `${name}.png`), png, "base64");
    console.log(`    [shot] ${name}.png`);
    await clearShotArtefacts(false);
  } catch (error) {
    console.log(`    [shot] ${name} highlight failed: ${String(error).slice(0, 120)}`);
    await shot(name);
  }
}

/**
 * Whether the C# extension is installed in the e2e VS Code instance — i.e. whether the `coreclr`
 * debug type exists at all.
 *
 * The plugin Test Explorer's Debug profile launches `type: "coreclr"`, contributed by
 * ms-dotnettools.csharp. The e2e instance deliberately runs a CLEAN extensions dir (ours only), so
 * .NET debugging is unavailable by default and the debug steps must self-skip rather than fail.
 *
 * Installing it on every run was rejected: it would load Roslyn into every plugin workspace on an 8GB
 * VM, which is the resource-starvation class of failure these suites already fight. Opt in with
 * `npm run test:e2e:debugger`.
 */
export function csharpExtensionInstalled(): boolean {
  try {
    return fs.readdirSync(path.join(repoRoot, "sandbox", "ext-dir-clean")).some((name) => /^ms-dotnettools\.csharp-/i.test(name));
  } catch {
    return false;
  }
}

/** Current byte length of the mirrored extension-output log file (a stable baseline to search
 *  AFTER, so `waitForLogFile` never matches a stale line from an earlier step). 0 if unset/missing. */
/** Current size of the mirrored log, in BYTES — pair only with waitForLogFile's `sinceByte`, which
 * slices bytes to match. */
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
      // Slice BYTES, not characters. `sinceByte` comes from logFileSize() → statSync().size, which
      // is a byte count, but `readFileSync(p, "utf8").slice(n)` slices UTF-16 code units — and the
      // extension's own log is full of multi-byte characters (✅, —, …, ✓, ✗), each 3 bytes but 1
      // unit. So the character slice skipped FURTHER than intended, by one character per extra byte,
      // and silently discarded the very lines being waited for. That is a whole class of phantom
      // "timed out waiting for X" failures — X had been logged, just before the mis-computed offset.
      // It was read as product slowness for a long time (#261): a 165-line log already drifts 30
      // characters, and a full run's log drifts far more.
      const buffer = fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0);
      tail = buffer.subarray(Math.min(since, buffer.length)).toString("utf8");
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
  // This prompt is either a picker (Global Discovery's environment list, a live network round-trip)
  // or the manual-URL text box, and the harness has to tell which before it can answer.
  //
  // Two ways to get this wrong, both of which this repo has now paid for:
  //
  // - Waiting a FIXED short time for items meant a slow discovery fell through to the text-box
  //   branch, typed the URL into an empty quick-pick FILTER, and Enter matched nothing. The picker
  //   sat there and every later answer went to the wrong prompt — four cascading failures.
  // - Scaling that wait with the caller's timeout "fixed" the above and broke the other side: a real
  //   text box never produces items, so it now blocked for the FULL timeout on every text prompt.
  //   The wizard stalled waiting to be answered and the suite went from 4/4 to 0/4.
  //
  // Waiting longer cannot distinguish them, because both look like "no items yet". Ask what the
  // widget IS instead: only a picker renders a list container. A picker gets the caller's full
  // timeout to populate; a text box is answered as soon as the short grace elapses.
  let pickCount = await waitForPicks(input, 10000);
  const isPicker = pickCount === 0 ? await inputIsPicker() : true;
  if (pickCount === 0 && isPicker) {
    console.log(`    [e2e] answerFlexible: picker present but still loading — waiting up to ${timeoutMs}ms for items`);
    pickCount = await waitForPicks(input, Math.max(0, timeoutMs - 10000));
  }
  if (pickCount > 0) {
    await selectPickMatching(input, value);
  } else if (isPicker) {
    // A picker that never populated must NOT fall through to the text-box branch. Typing into a
    // quick pick puts the text in its FILTER, Enter matches nothing, and the prompt stays open —
    // after which every later answer in the wizard goes to the wrong prompt and the whole suite
    // fails somewhere unrelated. That misdirection is what made this class of failure so expensive
    // to diagnose: the visible error was always several steps downstream of the cause.
    //
    // Fail here instead, naming the actual problem. The caller's timeout is the budget; if Global
    // Discovery needs longer than that, the timeout is what should change.
    await shot(`FAILED-picker-never-populated-${value}`).catch(() => undefined);
    throw new Error(
      `answerFlexible: the prompt for "${value}" is a quick pick that never populated within ${timeoutMs}ms. ` +
        `Refusing to type into its filter (that would leave the wizard open and misdirect every later answer). ` +
        `If this is a slow Global Discovery, raise this step's timeout.`,
    );
  } else {
    console.log(`    [e2e] answerFlexible: no quick picks after waiting — treating "${value}" as a text box`);
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
export async function focusWorkbench(): Promise<void> {
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
/**
 * Wait until the output channel contains EVERY string in `expected` (they are ANDed, not ORed).
 *
 * Passing alternatives here is a trap that cost a daily-failing suite: an array of four different
 * phrasings of "the import finished" can never all appear, so the wait burns its whole timeout and
 * the step fails while the command it is watching actually succeeded (#240). Pass the lines that
 * genuinely co-occur — ideally the command's FINAL signal — or a single string.
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
/**
 * Open a workspace FOLDER and prove it actually attached to the window Selenium drives.
 *
 * `VSBrowser.openResources` shells out to a reuse-window call, and on Linux that call used to do
 * NOTHING (#268): ExTester ran it through VS Code's Node CLI entry point
 * (`ELECTRON_RUN_AS_NODE=1 <code> cli.js -r <folder> …`), which exits 0, prints nothing, spawns no
 * lasting process — and never opens the folder. Bisected against invoking the Code binary directly
 * with the same arguments and the same user-data-dir, which reuses the window correctly; that fix
 * is applied to ExTester by scripts/patchExtester.mjs.
 *
 * The failure was silent in every layer, which is why this assertion still exists after the fix.
 * `execSync` saw exit 0, `waitForWorkbench()` succeeded because the workbench IS up (just
 * folder-less), the extension activated, the panel rendered and the connection wizard completed —
 * and then every path guarded on `vscode.workspace.workspaceFolders` no-opped. The first visible
 * symptom was "No input box appeared" three steps later, in a different function, because
 * generateTemplates and both restoreDependencies calls had bailed (two logging "No Template
 * Found", one only showing a toast).
 *
 * The window TITLE is the cheap, reliable signal — VS Code puts the folder name in it, and a
 * folder-less window is titled just "Visual Studio Code". So: open, then wait for the title to
 * carry the folder name, retrying the open once before failing with a message that names the
 * actual problem rather than letting a later step die of a missing prompt. Measured on Linux with
 * the patch in place, the title carries the folder within ~6s.
 *
 * This POLLS on every platform — it is not a Windows no-op. Measured on the Windows e2e host, the
 * driven window is titled exactly "Visual Studio Code" for the first ~8 SECONDS before the folder
 * attaches, i.e. transiently indistinguishable from the Linux failure. So the wait earns its keep
 * twice: it protects Linux against an attach that never happens, and Windows against one that is
 * merely slow (which a bare `waitForWorkbench()` would have sailed straight past). Cost there is
 * below measurement noise. Match with `includes`, never a prefix — the title carries an optional
 * leading editor segment ("file — folder — Visual Studio Code").
 */
export async function openWorkspaceFolder(dir: string, timeoutMs: number = 60000): Promise<void> {
  const folderName = path.basename(dir);
  const deadline = Date.now() + timeoutMs;
  let reopened = false;
  await VSBrowser.instance.openResources(dir);
  await VSBrowser.instance.waitForWorkbench();
  for (;;) {
    let title = "";
    try {
      title = await VSBrowser.instance.driver.getTitle();
    } catch {
      /* window not ready yet */
    }
    if (title.includes(folderName)) {
      return;
    }
    // The folder may have landed in a SECOND window (that is what `code -r` does when it can't
    // reach the running instance over IPC). Selenium can see those as extra window handles, so
    // look for one whose title carries the folder name and drive THAT window instead.
    const driver = VSBrowser.instance.driver;
    let handles: string[] = [];
    try {
      handles = await driver.getAllWindowHandles();
    } catch {
      /* session not ready */
    }
    if (handles.length > 1) {
      const current = await driver.getWindowHandle().catch(() => "");
      for (const handle of handles) {
        try {
          await driver.switchTo().window(handle);
          if ((await driver.getTitle()).includes(folderName)) {
            await VSBrowser.instance.waitForWorkbench();
            return;
          }
        } catch {
          /* handle went away */
        }
      }
      if (current) {
        await driver
          .switchTo()
          .window(current)
          .catch(() => undefined);
      }
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Workspace folder "${folderName}" never attached to the driven window (title: "${title}", ${handles.length} window handle(s)). ` +
          `The reuse-window call did not open it. On Linux that is #268 — check scripts/patchExtester.mjs still applies ` +
          `(it warns loudly when vscode-extension-tester changes shape and it can no longer patch \`CodeUtil.open\`).`,
      );
    }
    // One re-issue: the IPC may simply have lost the race with the workbench coming up.
    if (!reopened && Date.now() > deadline - timeoutMs / 2) {
      reopened = true;
      await VSBrowser.instance.openResources(dir);
      await VSBrowser.instance.waitForWorkbench();
    }
    await sleep(1000);
  }
}

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
    const res = await this.request("POST", "territories", { name: `Contoso South West ${Date.now()}` });
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
  /**
   * Re-activate the ORIGINAL steps of an assembly that profiling left disabled (#241).
   *
   * The Plugin Profiler clones a step and DEACTIVATES the original while profiling it. If a run never
   * reaches "Stop Profiling", the original stays disabled — and because the deploy's step sync reports
   * it "Unchanged" without touching `statecode`, the profilable query correctly finds nothing forever
   * after. One failed run therefore poisoned every later run of this suite. Returns how many it
   * re-enabled.
   */
  async reactivateAssemblySteps(assemblyName: string): Promise<number> {
    const filter = `plugintypeid/pluginassemblyid/name eq '${assemblyName.replace(/'/g, "''")}'`;
    const res = await this.request("GET", `sdkmessageprocessingsteps?$select=name,statecode,sdkmessageprocessingstepid&$filter=${filter}&$top=50`);
    if (!res.ok) {
      return 0;
    }
    const rows: any[] = ((await res.json()) as any).value ?? [];
    let reactivated = 0;
    for (const step of rows) {
      // Never touch the profiler's own clones — those get deleted, not re-enabled.
      if (step.statecode === 0 || /\((Profiler|Profiled)\)\s*$/.test(String(step.name ?? ""))) {
        continue;
      }
      const patch = await this.request("PATCH", `sdkmessageprocessingsteps(${step.sdkmessageprocessingstepid})`, { statecode: 0, statuscode: 1 });
      if (patch.ok || patch.status === 204) {
        reactivated++;
      }
    }
    return reactivated;
  }

  /**
   * Delete the profiler's clone steps on an entity.
   *
   * `ownedMarker` scopes the sweep to THIS run (#258): the clone's name is the original step's
   * name plus " (Profiler)", so a run id in the registered step name is still there on the clone.
   * Without it this deleted every profiler step on the entity whoever created it — so a run
   * finishing would delete a concurrent run's live clone mid-capture.
   *
   * Foreign clones are counted and returned rather than silently ignored: one left behind keeps
   * firing on every create in the shared org, so it needs to be VISIBLE in the log even though
   * deleting it is not this run's business.
   */
  async cleanupProfilerSteps(entityLogicalName: string, ownedMarker?: string): Promise<{ deleted: number; foreign: number }> {
    const filter = `sdkmessagefilterid/primaryobjecttypecode eq '${entityLogicalName.replace(/'/g, "''")}'`;
    const res = await this.request("GET", `sdkmessageprocessingsteps?$select=name,sdkmessageprocessingstepid&$expand=plugintypeid($select=typename)&$filter=${filter}`);
    if (!res.ok) {
      return { deleted: 0, foreign: 0 };
    }
    const rows: any[] = ((await res.json()) as any).value ?? [];
    let deleted = 0;
    let foreign = 0;
    for (const s of rows) {
      const disposition = profilerStepDisposition((s.name as string) ?? "", (s.plugintypeid?.typename as string) ?? "", ownedMarker);
      if (disposition === "keep") {
        continue;
      }
      if (disposition === "foreign") {
        foreign++;
        continue;
      }
      const del = await this.request("DELETE", `sdkmessageprocessingsteps(${s.sdkmessageprocessingstepid})`);
      if (del.ok || del.status === 204) {
        deleted++;
      }
    }
    return { deleted, foreign };
  }

  /**
   * Delete the captured profiles this suite created for a plugin type.
   *
   * Without this the org accumulates one `mbs_pluginprofile` per run, and once MORE THAN ONE exists
   * the download pulls several, so "Replay & debug" starts asking "Replay which profile?" — a prompt
   * nothing answers, which hangs the command and fails the step. The suite silently depended on a
   * pristine org; leave it as we found it. Returns how many were deleted.
   */
  async deletePluginProfilesForType(typeName: string): Promise<number> {
    const res = await this.request("GET", `mbs_pluginprofiles?$select=mbs_pluginprofileid&$filter=mbs_typename eq '${typeName.replace(/'/g, "''")}'&$top=100`);
    if (!res.ok) {
      return 0;
    }
    const rows: any[] = ((await res.json()) as any).value ?? [];
    let deleted = 0;
    for (const row of rows) {
      const del = await this.request("DELETE", `mbs_pluginprofiles(${row.mbs_pluginprofileid})`);
      if (del.ok || del.status === 204) {
        deleted++;
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

  // ---- PCF custom control (#227): prove an interactive push really landed, then remove it ----

  /**
   * The `customcontrol` row id for a `<namespace>.<constructor>` control, or undefined when absent.
   *
   * Dataverse PREFIXES the stored name with the publisher's customization prefix
   * (`dvpt_SampleNamespace.SampleControl`), so an equality filter on the manifest name never matches.
   */
  async findCustomControlId(fullName: string): Promise<string | undefined> {
    const lookup = customControlLookup(fullName);
    const res = await this.request("GET", lookup.resource);
    if (!res.ok) {
      return undefined;
    }
    const data: any = await res.json();
    return pickMatchingRow<{ name?: string; customcontrolid?: string }>(data?.value, lookup, "name")?.customcontrolid;
  }

  /** Force the org's plug-in trace level (0 Off, 1 Exception, 2 All) — teardown insurance for a shared org. */
  async setTraceLogLevel(level: 0 | 1 | 2): Promise<boolean> {
    const res = await this.request("GET", "organizations?$select=organizationid&$top=1");
    if (!res.ok) {
      return false;
    }
    const data: any = await res.json();
    const id = data?.value?.[0]?.organizationid;
    if (!id) {
      return false;
    }

    const patch = await this.request("PATCH", `organizations(${id})`, { plugintracelogsetting: level });
    return patch.ok;
  }

  /**
   * Whether the plug-in wrote a trace log — proof the run happened with tracing on (#231).
   *
   * `typename` is the ASSEMBLY-QUALIFIED name ("Ns.Class, Assembly, Version=…, Culture=…, PublicKeyToken=…"),
   * so an equality filter on the plain type name never matches even when the row is right there.
   */
  async hasTraceLogFor(typeName: string): Promise<boolean> {
    const lookup = pluginTraceLogLookup(typeName);
    const res = await this.request("GET", lookup.resource);
    if (!res.ok) {
      return false;
    }
    const data: any = await res.json();
    return pickMatchingRow<{ typename?: string }>(data?.value, lookup, "typename") !== undefined;
  }

  /** Whether a pushed control is a component OF the given solution (#256). */
  async isCustomControlInSolution(fullName: string, solutionUniqueName: string): Promise<boolean> {
    const id = await this.findCustomControlId(fullName);
    if (!id) {
      return false;
    }
    const res = await this.request(
      "GET",
      `solutioncomponents?$select=solutioncomponentid&$filter=objectid eq ${id} and solutionid/uniquename eq '${solutionUniqueName.replace(/'/g, "''")}'`,
    );
    if (!res.ok) {
      return false;
    }
    const data: any = await res.json();
    return (data?.value?.length ?? 0) > 0;
  }

  /** Delete a pushed custom control. Best-effort: a control referenced by a form cannot be removed. */
  async deleteCustomControl(fullName: string): Promise<boolean> {
    const id = await this.findCustomControlId(fullName);
    if (!id) {
      return false;
    }
    const res = await this.request("DELETE", `customcontrols(${id})`);
    return res.ok;
  }

  // ---- Custom API (#225): verify what the deploy actually created, then remove it ----

  /** The `customapi` row id for a unique name, or undefined when it is not in the environment. */
  async findCustomApiId(uniqueName: string): Promise<string | undefined> {
    const res = await this.request("GET", `customapis?$select=customapiid&$filter=uniquename eq '${uniqueName.replace(/'/g, "''")}'`);
    if (!res.ok) {
      return undefined;
    }
    const data: any = await res.json();
    return data?.value?.[0]?.customapiid;
  }

  /** The Custom API's binding/function flags and plugin type, as Dataverse actually stored them. */
  async getCustomApi(uniqueName: string): Promise<{ bindingtype: number; isfunction: boolean; displayname: string; plugintypeid?: string } | undefined> {
    const res = await this.request("GET", `customapis?$select=bindingtype,isfunction,displayname,_plugintypeid_value&$filter=uniquename eq '${uniqueName.replace(/'/g, "''")}'`);
    if (!res.ok) {
      return undefined;
    }
    const data: any = await res.json();
    const row = data?.value?.[0];
    return row ? { bindingtype: row.bindingtype, isfunction: row.isfunction, displayname: row.displayname, plugintypeid: row._plugintypeid_value } : undefined;
  }

  /** Request parameter + response property unique names for a deployed Custom API. */
  async getCustomApiMembers(customApiId: string): Promise<{ requestParameters: string[]; responseProperties: string[] }> {
    const read = async (entitySet: string): Promise<string[]> => {
      const res = await this.request("GET", `${entitySet}?$select=uniquename&$filter=_customapiid_value eq ${customApiId}`);
      if (!res.ok) {
        return [];
      }
      const data: any = await res.json();
      return (data?.value ?? []).map((row: any) => row.uniquename);
    };
    return { requestParameters: await read("customapirequestparameters"), responseProperties: await read("customapiresponseproperties") };
  }

  /** The `plugintype` row id for a type name — what the Custom API deploy has to find. */
  async findPluginTypeId(typeName: string): Promise<string | undefined> {
    const res = await this.request("GET", `plugintypes?$select=plugintypeid&$filter=typename eq '${typeName.replace(/'/g, "''")}'`);
    if (!res.ok) {
      return undefined;
    }
    const data: any = await res.json();
    return data?.value?.[0]?.plugintypeid;
  }

  /** Delete a Custom API and its members. Members go first — the API cannot be deleted under them. */
  async deleteCustomApi(uniqueName: string): Promise<boolean> {
    const id = await this.findCustomApiId(uniqueName);
    if (!id) {
      return false;
    }
    for (const entitySet of ["customapirequestparameters", "customapiresponseproperties"]) {
      const res = await this.request(
        "GET",
        `${entitySet}?$select=${entitySet === "customapirequestparameters" ? "customapirequestparameterid" : "customapiresponsepropertyid"}&$filter=_customapiid_value eq ${id}`,
      );
      if (res.ok) {
        const data: any = await res.json();
        for (const row of data?.value ?? []) {
          const memberId = row.customapirequestparameterid ?? row.customapiresponsepropertyid;
          await this.request("DELETE", `${entitySet}(${memberId})`);
        }
      }
    }
    await this.request("DELETE", `customapis(${id})`);
    return true;
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
