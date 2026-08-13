import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import {
  loadE2EEnv,
  freshWorkspace,
  answerText,
  answerFlexible,
  pickByLabel,
  runCommand,
  waitForFile,
  dismissOverlays,
  sleep,
  expectOutput,
  clearOutput,
  E2EClient,
  resetAllCredentials,
} from "./lib";
import { clickPanelButton, expandComponentCards } from "../supervised/supervisedLib";

// End-to-end: a PCF control created and pushed under INTERACTIVE (OAuth) sign-in (#227).
//
// #141 closed its interactive-auth box by ARGUMENT — PCF shares ensurePacAuthForCurrentConnection with
// the plugin and web-resource interactive suites, so it "must" work. That is the same reasoning that let
// this class of bug ship repeatedly: #91 (typings), #90 (register form events), #128/#129 (early-bound),
// #159 — all "shared code, must be fine", all broken under interactive because interactive sets NO
// tenantId and something gated on it.
//
// PCF is the one component type whose Dataverse path runs through `pac` rather than the Web API, so its
// OAuth story is the LEAST like the suites that already pass: the pac profile has to be created from a
// connection that has no client secret and no tenant. Only a live push proves it.
//
// The interactive connect is silent because DVPT_TEST_MSAL_CACHE_FILE points at a cache pre-seeded by
// preAcquireInteractiveCache.mjs (there is no browser to drive inside ExTester). Self-skips without
// sandbox/.env or a seeded cache.
/** First file anywhere under dir whose name matches (skips node_modules/obj). */
function findDeep(dir: string, predicate: (name: string) => boolean): string | undefined {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && predicate(entry.name)) {
      return full;
    }
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "obj") {
      const hit = findDeep(full, predicate);
      if (hit) {
        return hit;
      }
    }
  }
  return undefined;
}

/** findDeep, polled — `pac pcf init` plus npm install takes minutes. */
async function pollDeep(dir: string, predicate: (name: string) => boolean, timeoutMs: number): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = findDeep(dir, predicate);
    if (hit) {
      return hit;
    }
    if (Date.now() > deadline) {
      return undefined;
    }
    await sleep(4000);
  }
}

describe("PCF lifecycle — interactive auth (e2e)", function () {
  this.timeout(1800000);
  const env = loadE2EEnv();
  const hasCache = !!process.env.DVPT_TEST_MSAL_CACHE_FILE && fs.existsSync(process.env.DVPT_TEST_MSAL_CACHE_FILE || "");
  /** Read from the manifest pac writes — the wizard does not ask for either. */
  let controlNamespace = "";
  let controlConstructor = "";
  let workspace: string;
  let solutionFriendlyName: string;
  let client: E2EClient;

  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      try {
        const dir = path.resolve(__dirname, "..", "..", "..", "sandbox", "screenshots-out");
        fs.mkdirSync(dir, { recursive: true });
        const img = await VSBrowser.instance.driver.takeScreenshot();
        const name = (this.currentTest?.title || "step").replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
        fs.writeFileSync(path.join(dir, `e2e-pcf-int-fail-${name}.png`), img, "base64");
      } catch {
        /* ignore */
      }
    }
  });

  /** Read visible notification text: a command can error AFTER writing files, so file asserts alone lie. */
  async function assertCommandDidNotError(context: string): Promise<void> {
    await sleep(2500);
    let text = "";
    try {
      text = String(
        (await VSBrowser.instance.driver.executeScript(
          "return Array.from(document.querySelectorAll('.notification-list-item-message, .notification-toast')).map(function(e){return e.textContent || '';}).join(' ||| ');",
        )) ?? "",
      );
    } catch {
      text = "";
    }
    expect(/resulted in an error|Error /i.test(text), `no error notification after ${context} — saw: ${text.slice(0, 200)}`).to.equal(false);
    await dismissOverlays();
  }

  before(async function () {
    if (!env || !hasCache) {
      this.skip();
    }
    client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;
    workspace = freshWorkspace("pcf-interactive");
    await VSBrowser.instance.openResources(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    try {
      await runCommand("Dataverse PowerTools: Show Log");
    } catch {
      /* the command may not be registered until the extension activates */
    }
  });

  it("creates a PCF project via the wizard using interactive sign-in", async () => {
    const log = (m: string): void => console.log(`    [e2e] ${m}`);
    // Fresh-credential isolation: service-principal leftovers once masked a broken OAuth path.
    await resetAllCredentials(log);
    await runCommand("Dataverse PowerTools: Initialise Project");
    log("project type: PCF Control");
    await pickByLabel("PCF Control");
    log("auth type: OAuth");
    await pickByLabel("OAuth");
    // Silent sign-in from the seeded cache, then environments come from Global Discovery — no
    // tenant/clientId/clientSecret prompts at all, which is the condition under which the bugs above hid.
    log("environment (silent sign-in + discovery)");
    await answerFlexible(env!.url, 180000);
    log(`solution (${solutionFriendlyName})`);
    await pickByLabel(solutionFriendlyName);
    // Template + framework are the ONLY control prompts: pac pcf init names the control itself, and the
    // namespace/constructor are read back from the manifest below.
    log("control template");
    await pickByLabel("Field", 120000);
    log("rendering framework");
    await pickByLabel("Standard (no framework)", 120000);
    // pac pcf init + npm install run here, so allow for the restore.
    expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 300000), "dataverse-powertools.json").to.equal(true);
    const manifestPath = await pollDeep(workspace, (name) => name === "ControlManifest.Input.xml", 600000);
    expect(manifestPath, "ControlManifest.Input.xml scaffolded").to.not.equal(undefined);
    const xml = fs.readFileSync(manifestPath!, "utf8");
    controlNamespace = /namespace="([^"]+)"/.exec(xml)?.[1] ?? "";
    controlConstructor = /constructor="([^"]+)"/.exec(xml)?.[1] ?? "";
    expect(controlNamespace, "manifest namespace").to.not.equal("");
    expect(controlConstructor, "manifest constructor").to.not.equal("");
    console.log(`    [e2e] scaffolded control ${controlNamespace}.${controlConstructor}`);
    await assertCommandDidNotError("PCF init (interactive)");
  });

  // No-auth sanity first: if scaffolding regressed, the suite says so here rather than blaming OAuth.
  it("refreshes types and builds locally (scaffolding sanity, no auth involved)", async () => {
    // Buttons, not the command palette: the PCF commands are enablement-gated on
    // `dataverse-powertools.isPcf`, so a palette entry that is filtered out silently does NOTHING —
    // no command, no output, no error, just a suite waiting 20 minutes for a line that cannot come.
    // The card is also what a user clicks.
    await clearOutput();
    await expandComponentCards();
    await clickPanelButton("Refresh Types", { timeoutMs: 45000 });
    await expectOutput(["PCF types refreshed successfully."], { step: "refresh pcf types", timeoutMs: 600000 });
    await assertCommandDidNotError("Refresh Types");

    await clearOutput();
    await expandComponentCards();
    await clickPanelButton("Local Build", { timeoutMs: 45000 });
    await expectOutput(["PCF build completed successfully."], { step: "build pcf", timeoutMs: 900000 });
    await assertCommandDidNotError("Local Build");
  });

  // THE point of this suite: `pac pcf push` under a connection with no secret and no tenant.
  it("PUSHES the control to the environment under interactive auth, and it lands in Dataverse", async () => {
    // `pac pcf init` names the control from its own defaults (SampleNamespace.SampleControl), so the name
    // is NOT unique per run — a row left by an earlier run would satisfy the assertions below without
    // this push doing anything. Delete it first, so "it exists" can only mean this push created it. (The
    // same hollow assertion made #249's bogus build failure invisible.)
    const existing = await client.deleteCustomControl(`${controlNamespace}.${controlConstructor}`).catch(() => false);
    if (existing) {
      console.log(`    [e2e] removed a pre-existing ${controlNamespace}.${controlConstructor} so the push has to recreate it`);
      await sleep(5000);
    }

    await clearOutput();
    await expandComponentCards();
    // "▶ Push to {environment}" — substring match for the prefix and the environment name.
    await clickPanelButton("Push to", { timeoutMs: 45000, contains: true });
    // Gate on the command's FINAL line, not on pac chatter: pac exits 0 even on failure in this repo's
    // experience, so the extension's own completion line is the signal.
    await expectOutput(["PCF push complete."], { step: "push pcf (interactive)", timeoutMs: 1200000 });
    await assertCommandDidNotError("Push PCF Control");

    // Verify in Dataverse, not from our log. Two things, because either alone can mislead: the
    // customcontrol row (the control is registered) and its bundle web resource (the code really landed).
    const fullName = `${controlNamespace}.${controlConstructor}`;
    const controlId = await (async (): Promise<string | undefined> => {
      const deadline = Date.now() + 420000;
      for (;;) {
        const found = await client.findCustomControlId(fullName).catch(() => undefined);
        if (found || Date.now() > deadline) {
          return found;
        }
        await sleep(7000);
      }
    })();
    expect(controlId, `customcontrol ${fullName} exists in Dataverse after an INTERACTIVE push`).to.not.equal(undefined);
    const bundle = await client.findWebresourceId(`cc_${fullName}/bundle.js`).catch(() => undefined);
    expect(bundle, `the control's bundle web resource cc_${fullName}/bundle.js landed`).to.not.equal(undefined);
  });

  it("adds the control to the solution — Add PCF Control to Solution (interactive)", async () => {
    await clearOutput();
    await expandComponentCards();
    await clickPanelButton("Add to Solution", { timeoutMs: 45000 });
    await expectOutput(["PCF control added as a solution reference."], { step: "add pcf to solution", timeoutMs: 300000 });
    await assertCommandDidNotError("Add PCF Control to Solution");
  });

  after(async function () {
    if (!env || !hasCache) {
      return;
    }
    try {
      if (controlNamespace && controlConstructor) {
        const removed = await client.deleteCustomControl(`${controlNamespace}.${controlConstructor}`);
        if (removed) {
          console.log(`[cleanup] deleted custom control ${controlNamespace}.${controlConstructor}`);
        }
      }
    } catch (error) {
      console.log(`[cleanup] could not delete custom control: ${String(error).slice(0, 120)}`);
    }
  });
});
