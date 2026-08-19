import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import {
  openWorkspaceFolder,
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
  waitForLogFile,
  logFileSize,
  E2EClient,
  resetAllCredentials,
} from "./lib";
import { clickPanelButton, expandComponentCards } from "../supervised/supervisedLib";
import { completeDeviceCodeLogin, parseDeviceCode } from "./browserLib";
import { resolveBrowser } from "../../webresources/debug/browserResolver";

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
    // Only VS Code's own command-failure toast and the extension's explicit "Error <verb>ing" messages.
    // A looser /Error /i matched the word inside `npm install --loglevel=error` in a PROGRESS
    // notification (and inside the CSS that comes back with the notification's text), failing a step
    // that had gone fine.
    const failed = /resulted in an error/i.test(text) || /\bError (building|refreshing|pushing|running|deploying)\b/i.test(text);
    expect(failed, `no error notification after ${context} — saw: ${text.slice(0, 200)}`).to.equal(false);
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
    await openWorkspaceFolder(workspace);
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
    // The manifest is written by `pac pcf init`, which finishes LONG before `npm install` does — so a
    // file assert says "ready" while node_modules/.bin is still filling up. Clicking Refresh Types there
    // ran `pcf-scripts` before it existed and reported "'pcf-scripts' is not recognized", which looks
    // exactly like the missing-local-bin bug this repo has had before but was just a race with the
    // restore. Wait for the restore's OWN final line.
    await expectOutput(["Restore Complete."], { step: "npm restore after pcf init", timeoutMs: 900000 });
    await assertCommandDidNotError("PCF init (interactive)");
  });

  // No-auth sanity first: if scaffolding regressed, the suite says so here rather than blaming OAuth.
  it("refreshes types and builds locally (scaffolding sanity, no auth involved)", async () => {
    // Buttons, not the command palette: the PCF commands are enablement-gated on
    // `dataverse-powertools.isPcf`, so a palette entry that is filtered out silently does NOTHING —
    // no command, no output, no error, just a suite waiting 20 minutes for a line that cannot come.
    // The card is also what a user clicks.
    // Wait for the LOCAL BIN to settle, not just for a "Restore Complete." line. The component restores
    // more than once (init, then again on discovery), and `npm install` empties and refills
    // node_modules/.bin while it runs — so a command launched in that window dies with
    // "'pcf-scripts' is not recognized", which reads exactly like this repo's missing-local-bin bug and
    // is really a race. The bin existing, and STAYING there, is the precondition the command needs.
    const localBin = path.join(workspace, "node_modules", ".bin", process.platform === "win32" ? "pcf-scripts.cmd" : "pcf-scripts");
    const binReady = await (async (): Promise<boolean> => {
      const deadline = Date.now() + 900000;
      let consecutive = 0;
      while (Date.now() < deadline) {
        consecutive = fs.existsSync(localBin) ? consecutive + 1 : 0;
        if (consecutive >= 3) {
          return true;
        }
        await sleep(5000);
      }
      return false;
    })();
    expect(binReady, "node_modules/.bin/pcf-scripts settled before running the pcf-scripts commands").to.equal(true);

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

    const pushBaseline = logFileSize();
    await clearOutput();
    await expandComponentCards();
    // "▶ Push to {environment}" — substring match for the prefix and the environment name.
    await clickPanelButton("Push to", { timeoutMs: 45000, contains: true });

    // `pac pcf push` needs a pac profile, and under interactive auth there is NO client secret — so
    // `pac auth create` uses the device-code flow: it prints a code and blocks until someone enters it.
    // That is correct behaviour, and it is the reason this path had never been covered unattended. The
    // test account is MFA-exempt in a dedicated dev tenant, so drive it: read pac's own code out of the
    // log and complete the sign-in in a browser.
    const deviceLog = await waitForLogFile(/enter the code\s+[A-Z0-9]{6,}/i, { timeoutMs: 240000, sinceByte: pushBaseline }).catch(() => "");
    const code = parseDeviceCode(deviceLog);
    if (code) {
      console.log(`    [e2e] pac asked for device code ${code} — completing the sign-in`);
      const resolved = resolveBrowser("auto", undefined, { platform: process.platform, env: process.env, exists: fs.existsSync });
      expect(resolved?.executablePath, "a browser to complete the device-code sign-in").to.not.equal(undefined);
      const completed = await completeDeviceCodeLogin(resolved.executablePath!, path.join(os.tmpdir(), `dvpt-devicecode-${Date.now()}`), code, {
        username: env!.username!,
        password: env!.password!,
        log: (m) => console.log(`    [e2e] ${m}`),
      });
      expect(completed, "the device-code sign-in completed").to.equal(true);
    } else {
      // A profile may already exist from an earlier run, in which case pac never asks. Say which
      // happened, so a green run cannot quietly stop covering the device-code path.
      console.log("    [e2e] pac did not ask for a device code — an existing pac profile was reused");
    }
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
    // #256: this adds the PUSHED control to the solution configured for the component, like a web
    // resource — no Solution project required, so no `added as a solution reference` line here.
    await expectOutput([`Added PCF control '${controlNamespace}.${controlConstructor}' to solution`], { step: "add pcf to solution", timeoutMs: 300000 });
    await assertCommandDidNotError("Add to Solution");

    // Confirm in Dataverse: the control is a component OF that solution, not merely that we logged it.
    const inSolution = await client.isCustomControlInSolution(`${controlNamespace}.${controlConstructor}`, env!.solutionName);
    expect(inSolution, `the control is a component of solution '${env!.solutionName}'`).to.equal(true);
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
