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
describe("PCF lifecycle — interactive auth (e2e)", function () {
  this.timeout(1800000);
  const env = loadE2EEnv();
  const hasCache = !!process.env.DVPT_TEST_MSAL_CACHE_FILE && fs.existsSync(process.env.DVPT_TEST_MSAL_CACHE_FILE || "");
  /** Unique per run: a control left in the org by an earlier run would make "pushed" un-provable. */
  const namespaceName = "DvptE2E";
  const controlName = `IntCtl${Date.now().toString().slice(-6)}`;
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
    log("namespace");
    await answerText(namespaceName);
    log("control name");
    await answerText(controlName);
    log("template");
    await pickByLabel("Field", 120000);
    log("framework");
    // The label is "Standard (no framework)" — the VALUE is "none", which is not what the picker shows.
    await pickByLabel("Standard (no framework)", 120000);
    // pac pcf init + npm install run here, so allow for the restore.
    expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 300000), "dataverse-powertools.json").to.equal(true);
    const manifest = path.join(workspace, controlName, "ControlManifest.Input.xml");
    expect(await waitForFile(manifest, 600000), `${controlName}/ControlManifest.Input.xml`).to.equal(true);
    await assertCommandDidNotError("PCF init (interactive)");
  });

  // No-auth sanity first: if scaffolding regressed, the suite says so here rather than blaming OAuth.
  it("refreshes types and builds locally (scaffolding sanity, no auth involved)", async () => {
    await clearOutput();
    await runCommand("Dataverse PowerTools: Refresh PCF Types");
    await expectOutput(["PCF types refreshed successfully."], { step: "refresh pcf types", timeoutMs: 600000 });
    await assertCommandDidNotError("Refresh PCF Types");

    await clearOutput();
    await runCommand("Dataverse PowerTools: Build PCF Control");
    await expectOutput(["PCF build completed successfully."], { step: "build pcf", timeoutMs: 900000 });
    await assertCommandDidNotError("Build PCF Control");
  });

  // THE point of this suite: `pac pcf push` under a connection with no secret and no tenant.
  it("PUSHES the control to the environment under interactive auth, and it lands in Dataverse", async () => {
    await clearOutput();
    await runCommand("Dataverse PowerTools: Push PCF Control");
    // Gate on the command's FINAL line, not on pac chatter: pac exits 0 even on failure in this repo's
    // experience, so the extension's own completion line is the signal.
    await expectOutput(["PCF push complete."], { step: "push pcf (interactive)", timeoutMs: 1200000 });
    await assertCommandDidNotError("Push PCF Control");

    // Verify in Dataverse, not from our log: the customcontrol row has to exist, named
    // <namespace>.<control>. Push imports it through a temporary solution, so allow a moment.
    const fullName = `${namespaceName}.${controlName}`;
    const id = await (async (): Promise<string | undefined> => {
      const deadline = Date.now() + 300000;
      for (;;) {
        const found = await client.findCustomControlId(fullName).catch(() => undefined);
        if (found || Date.now() > deadline) {
          return found;
        }
        await sleep(7000);
      }
    })();
    expect(id, `customcontrol ${fullName} exists in Dataverse after an interactive push`).to.not.equal(undefined);
  });

  it("adds the control to the solution — Add PCF Control to Solution (interactive)", async () => {
    await clearOutput();
    await runCommand("Dataverse PowerTools: Add PCF Control to Solution");
    await expectOutput(["PCF control added as a solution reference."], { step: "add pcf to solution", timeoutMs: 300000 });
    await assertCommandDidNotError("Add PCF Control to Solution");
  });

  after(async function () {
    if (!env || !hasCache) {
      return;
    }
    try {
      const removed = await client.deleteCustomControl(`${namespaceName}.${controlName}`);
      if (removed) {
        console.log(`[cleanup] deleted custom control ${namespaceName}.${controlName}`);
      }
    } catch (error) {
      console.log(`[cleanup] could not delete custom control: ${String(error).slice(0, 120)}`);
    }
  });
});
