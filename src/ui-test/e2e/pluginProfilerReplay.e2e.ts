import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import {
  loadE2EEnv,
  freshWorkspace,
  answerText,
  pickByLabel,
  waitForFile,
  dismissOverlays,
  sleep,
  waitForLogFile,
  logFileSize,
  pushModalButton,
  pickManyByLabel,
  pickFirst,
  E2EClient,
  csharpExtensionInstalled,
  shot,
  shotWithHighlight,
  runCommand,
} from "./lib";
import { clickPanelButton, expandComponentCards } from "../supervised/supervisedLib";
import { initProject, step, showLog } from "./acceptanceLib";

// DEBUGGING e2e (button-driven, live Dataverse, WINDOWS-ONLY): the full plug-in "capture → replay →
// execute" loop through the panel's Debugging block. Deploys a plugin registered on Create-of-
// territory, proves the getProfilableSteps $top=200 fix finds the step in a busy org, then:
//   Profile next run  → the extension prepares the PACKAGE assembly for profiling (populates the
//                       otherwise-null pluginassembly.content from the deployed package, #208) and
//                       Start-Profiles the step;
//   trigger           → a throwaway territory create (Web API) fires the async step;
//   Continue          → downloads the captured profile into profiles/;
//   Replay & debug    → generates Replay_<Type>_<stamp>.cs + the in-process DvptReplay harness;
//   dotnet test       → the generated replay RUNS GREEN (#210): the in-process harness deserializes the
//                       captured .profile into an IPluginExecutionContext and re-executes the real
//                       plugin against it — no child AppDomain, so it actually runs in the test host.
//                       This end-to-end proves profiling now works for the extension's PACKAGE plugins
//                       (#208) AND that a captured run replays back through the plugin (#210).
// The click window is gated on the extension's log FILE (waitForLogFile), not Selenium polling, so
// the session survives on the 8GB VM. Self-skips off Windows and without live creds. See TESTING.md.
const COMPONENT = "Plugin";
let breakpointLine = 0;
const isWindows = process.platform === "win32";

/** First file anywhere under dir (recursive, skips obj) whose name matches, polled until found. */
async function waitForMatchDeep(dir: string, predicate: (name: string) => boolean, timeoutMs: number): Promise<string | undefined> {
  const walk = (d: string): string | undefined => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isFile() && predicate(e.name)) {
        return full;
      }
      if (e.isDirectory() && e.name !== "obj" && e.name !== "node_modules") {
        const hit = walk(full);
        if (hit) {
          return hit;
        }
      }
    }
    return undefined;
  };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = walk(dir);
    if (hit) {
      return hit;
    }
    if (Date.now() > deadline) {
      return undefined;
    }
    await sleep(3000);
  }
}

/** A plugin registered on Create-of-territory (Post, ASYNC, Sandbox) that traces the target — a
 *  Web-API-creatable table so the trigger is deterministic, and small enough to replay green. ASYNC
 *  keeps the test simple: the create returns 204 immediately and the profiler runs in a background
 *  job, so the test never has to reason about the trigger's own response. (Profiling works for both
 *  sync and async once the package assembly's content is populated — #208.) The namespace/class must
 *  match the scaffolded file so `Build & deploy` discovers the [CrmPluginRegistration]. */
function territoryPluginSource(namespaceName: string, className: string): string {
  return `using Microsoft.Xrm.Sdk;
using System;

namespace ${namespaceName}
{
    [CrmPluginRegistration(MessageNameEnum.Create, "territory", StageEnum.PostOperation, ExecutionModeEnum.Asynchronous, "", "Create territory (DVPT profiler e2e)", 1, IsolationModeEnum.Sandbox)]
    public class ${className} : PluginBase
    {
        public ${className}(string unsecureConfiguration, string secureConfiguration)
            : base(typeof(${className}))
        {
        }

        protected override void ExecuteDataversePlugin(ILocalPluginContext localPluginContext)
        {
            if (localPluginContext == null)
            {
                throw new ArgumentNullException(nameof(localPluginContext));
            }

            var context = localPluginContext.PluginExecutionContext;
            if (context.InputParameters.Contains("Target") && context.InputParameters["Target"] is Entity target)
            {
                localPluginContext.Trace("DVPT profiler e2e fired for territory " + target.Id);
            }
        }
    }
}
`;
}

describe("DEBUGGING: Plugin — profile capture → replay → execute via panel buttons", function () {
  this.timeout(3600000);
  const env = loadE2EEnv();
  let workspace: string;
  let solutionFriendlyName: string;
  let client: E2EClient;
  const projectName = "ProfilerE2E";
  const packageName = "ProfilerE2E";
  const className = "ProfilerProbe";
  let typeName = `${projectName}.${className}`; // refined from the scaffolded file's real namespace
  let triggeredTerritoryId: string | undefined;

  function pkgUnique(): string {
    const settings = JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8"));
    return `${settings.prefix ?? env?.prefix}_${packageName}`;
  }

  before(async function () {
    if (!env || !isWindows) {
      this.skip();
    }
    client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;
    workspace = freshWorkspace("dbg-profiler");
    await VSBrowser.instance.openResources(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    await showLog();
  });

  it("starts a Plugins project WITH unit testing + a plugin class (Initialise button + wizard)", async () => {
    await step(COMPONENT, "Scaffold plugin project + test project + class", async () => {
      await initProject("Plugins", env!, solutionFriendlyName, async () => {
        await answerText(projectName); // plugin project name
        await answerText(packageName); // plugin package name
        await answerText("1.0.0"); // version
        await pickByLabel("Yes", 600000); // set up unit testing? (pac plugin init + restore run first)
        await pickByLabel("xUnit", 120000); // unit test framework
        await pickByLabel("Yes", 300000); // create a plugin class? (test-project setup runs first)
        await answerText(className); // class name
      });
      const cs = path.join(workspace, projectName, `${className}.cs`);
      expect(await waitForFile(cs, 120000), "plugin class scaffolded").to.equal(true);
      const testCsproj = await waitForMatchDeep(workspace, (n) => n === `${projectName}.Tests.csproj`, 120000);
      expect(testCsproj, "unit test project scaffolded").to.not.equal(undefined);
      return `scaffolded ${projectName}/${className}.cs + ${projectName}.Tests (xUnit)`;
    });
  });

  it("writes the plugin logic — a Create-of-territory step that traces the target", async () => {
    await step(COMPONENT, "Write code (register step on Create of territory)", async () => {
      const cs = path.join(workspace, projectName, `${className}.cs`);
      const scaffolded = fs.readFileSync(cs, "utf8");
      const ns = /namespace\s+([A-Za-z0-9_.]+)/.exec(scaffolded)?.[1] ?? projectName;
      typeName = `${ns}.${className}`;
      fs.writeFileSync(cs, territoryPluginSource(ns, className), "utf8");
      return `wrote ${projectName}/${className}.cs — [CrmPluginRegistration(Create, territory, Post, Async)] type ${typeName}`;
    });
  });

  it("registers the step + publishes the package (Build & deploy package); verified in Dataverse", async () => {
    await step(COMPONENT, "Build + register step + publish (Build & deploy package)", async () => {
      await expandComponentCards();
      await clickPanelButton("Build & deploy package", { timeoutMs: 30000, contains: true }); // primary "▶ " prefix
      let id: string | undefined;
      const deadline = Date.now() + 480000;
      do {
        try {
          id = await client.findPluginPackageId(pkgUnique());
        } catch {
          /* transient */
        }
        if (id) {
          break;
        }
        await sleep(6000);
      } while (Date.now() < deadline);
      if (!id) {
        throw new Error(`plugin package ${pkgUnique()} not found in Dataverse after deploy`);
      }
      await sleep(10000); // let the sdkmessageprocessingstep settle so it's profilable
      return `plugin package ${pkgUnique()} deployed (id ${id}); step registered on Create of territory`;
    });
  });

  it("the deployed step is discoverable as PROFILABLE (getProfilableSteps $top=200 fix)", async () => {
    await step(COMPONENT, "Step is profilable (server-side assembly filter)", async () => {
      // The extension's capture uses a server-side assembly filter now, so a freshly-registered step
      // is found even though this org has 200+ active system (Microsoft.*) steps. Assert it live —
      // this is the reliable heart of the debugging loop (before the modal that the VM can't drive).
      //
      // SELF-HEAL first (#241): profiling DEACTIVATES the step it profiles, and a run that never
      // reached "Stop Profiling" leaves it that way. The deploy above reports such a step "Unchanged"
      // without touching `statecode`, so the profilable query then correctly finds nothing — one
      // failed run used to poison every later run permanently. Re-enable before asserting.
      const reactivated = await client.reactivateAssemblySteps(projectName).catch(() => 0);
      if (reactivated > 0) {
        console.log(`    [e2e] re-enabled ${reactivated} step(s) left disabled by an earlier profiling run`);
      }

      let count = 0;
      const deadline = Date.now() + 120000;
      do {
        count = await client.profilableStepCount(projectName).catch(() => 0);
        if (count > 0) {
          break;
        }
        await sleep(6000);
      } while (Date.now() < deadline);
      if (count < 1) {
        throw new Error(`no profilable step found for assembly ${projectName} — the $top=200 fix regressed or the step didn't register`);
      }
      return `${count} profilable step(s) discoverable for assembly ${projectName} (busy org, 200+ system steps)`;
    });
  });

  // The OTHER way to choose what to profile: a CodeLens on the [CrmPluginRegistration] attribute of the
  // step itself, so the step is chosen by clicking its own registration rather than by answering a
  // picker. Nothing asserted this lens existed before — it was manual-only (#224).
  it("offers a per-step Profile CodeLens on the registration attribute (how you choose the step)", async () => {
    await step(COMPONENT, "Per-step Profile CodeLens is offered on the registration", async () => {
      const pluginCs = await waitForMatchDeep(workspace, (n) => n === `${className}.cs`, 30000);
      if (!pluginCs) {
        throw new Error(`${className}.cs not found`);
      }
      await VSBrowser.instance.openResources(pluginCs);
      await sleep(3000);
      await dismissOverlays();

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { TextEditor, EditorView } = require("vscode-extension-tester");
      // Activate the plugin FILE first: earlier steps open the generated Replay_*.cs, and both
      // breakpoints and CodeLens reads act on whatever editor is active (which is why a
      // breakpoint on line ${breakpointLine} once failed against the much shorter replay file).
      await new EditorView().openEditor(`${className}.cs`).catch(() => undefined);
      await sleep(1500);
      const titles: string[] = [];
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        try {
          const lenses = await new TextEditor().getCodeLenses();
          titles.length = 0;
          for (const lens of lenses) {
            titles.push(await lens.getText());
          }
          if (titles.some((t) => /Profile:/.test(t))) {
            break;
          }
        } catch {
          /* lenses resolve asynchronously */
        }
        await sleep(3000);
      }
      expect(
        titles.some((t) => /Profile:\s*(Off|On)/.test(t)),
        `a "Profile: Off/On" CodeLens on the registration — saw: ${titles.join(" | ")}`,
      ).to.equal(true);
      await shotWithHighlight(".codelens-decoration a", "02-profile-codelens-select-step", { text: "Profile:" });
      return `per-step Profile CodeLens offered (${titles.filter((t) => /Profile:/.test(t)).join(", ")})`;
    });
  });

  it("captures a real run — Profile next run (prepares the package assembly) → trigger → Continue → download", async () => {
    await step(COMPONENT, "Capture a production run (Profile next run + live trigger)", async () => {
      // Reclaim RAM before capture — the just-finished Build & deploy leaves MSBuild/VBCSCompiler
      // build-server processes resident, and the net48 profiler tool spawning on top on the 8GB VM
      // is tight.
      try {
        spawnSync("dotnet", ["build-server", "shutdown"], { encoding: "utf8", timeout: 60000, shell: false });
      } catch {
        /* best-effort */
      }
      await sleep(4000);
      await expandComponentCards();
      await shot("00-debugging-block");
      const logBaseline = logFileSize();
      await clickPanelButton("Profile next run", { timeoutMs: 30000, shot: "01-profile-next-run-button" });
      // Gate the enable window on the extension's OWN log line via the mirrored FILE (no WebDriver
      // polling across the click — that's what lost the session on the 8GB VM). "Started profiling"
      // appears only after the extension prepared the package assembly (populated content) and
      // enabled — so its presence proves both worked and the modal is up.
      await waitForLogFile("[Profiler] Started profiling", { timeoutMs: 240000, sinceByte: logBaseline });
      // Fire the async step via the Web API; the create returns immediately + the profiler runs in a
      // background job and persists the profile.
      triggeredTerritoryId = await client.createTerritory();
      if (!triggeredTerritoryId) {
        throw new Error("could not create a territory to trigger the plugin");
      }
      // Confirm the capture persisted via the ORG (network, no Selenium) before dismissing the modal.
      let captured = false;
      const capDeadline = Date.now() + 150000;
      do {
        captured = await client.hasPluginProfileForType(typeName).catch(() => false);
        if (captured) {
          break;
        }
        await sleep(5000);
      } while (Date.now() < capDeadline);
      if (!captured) {
        throw new Error(`profiler did not persist a run for ${typeName} within 150s of the trigger`);
      }
      // One WebDriver action now that the session is healthy: dismiss the modal → downloadPluginProfiles
      // runs and shows its canPickMany picker; pick ours.
      await shotWithHighlight(".monaco-dialog-box .monaco-button", "03-trigger-then-continue-modal");
      await pushModalButton("Continue");
      await shotWithHighlight(".quick-input-widget .monaco-list-row", "04-pick-captured-profile");
      await pickManyByLabel(className, 60000);
      // downloadPluginProfiles writes into `<componentRoot>/profiles` (the root that holds
      // dataverse-powertools.json — the workspace root here, not the plugin subproject), so search
      // the whole workspace for the downloaded .profile.
      const gotProfile = await waitForMatchDeep(workspace, (n) => n.includes(".profile"), 120000);
      if (!gotProfile) {
        throw new Error(`no .profile downloaded anywhere under the workspace (org captured=${captured})`);
      }
      return `captured + downloaded ${path.basename(gotProfile)} (package assembly prepared, profile for ${typeName})`;
    });
  });

  it("generates a replay test — Replay & debug", async () => {
    await step(COMPONENT, "Generate replay test (Replay & debug)", async () => {
      await expandComponentCards();
      await clickPanelButton("Replay & debug", { timeoutMs: 30000, shot: "05-replay-and-debug-button" });
      // With more than one downloaded profile the command asks "Replay which profile?" — answer it
      // (newest first) instead of leaving the command blocked on an unanswered prompt.
      await shotWithHighlight(".quick-input-widget .monaco-list-row", "05b-replay-which-profile");
      await pickFirst(15000).catch(() => undefined);
      const replay = await waitForMatchDeep(workspace, (n) => /^Replay_.*\.cs$/.test(n), 120000);
      if (!replay) {
        throw new Error("no Replay_*.cs generated in the test project");
      }
      return `generated ${path.relative(workspace, replay)}`;
    });
  });

  it("RUNS the generated replay test GREEN — dotnet test re-executes the captured plugin in-process (#210)", async () => {
    await step(COMPONENT, "Run replay test (dotnet test — replay executes green)", async () => {
      const replay = await waitForMatchDeep(workspace, (n) => /^Replay_.*\.cs$/.test(n), 30000);
      const testCsproj = await waitForMatchDeep(workspace, (n) => n === `${projectName}.Tests.csproj`, 30000);
      if (!replay || !testCsproj) {
        throw new Error("replay test or test project missing");
      }
      // The in-process harness (#210) deserializes the captured .profile into an IPluginExecutionContext
      // (base64 → raw-DEFLATE → Report XML → DataContract PluginExecutionContext) and invokes the real
      // plugin's Execute against a stub service provider — NO child AppDomain, so it actually RUNS in the
      // `dotnet test` host. This asserts the replay passes: the captured Create-of-territory context is
      // fed back through the plugin and it traces without throwing.
      const res = spawnSync("dotnet", ["test", testCsproj, "--nologo", "-v", "minimal", "--filter", "FullyQualifiedName~Replay_"], {
        cwd: workspace,
        encoding: "utf8",
        timeout: 600000,
        shell: false,
      });
      const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
      if (res.status !== 0 || /error CS\d+/.test(out) || /Failed:\s*[1-9]/.test(out) || !/Passed!/.test(out)) {
        throw new Error(`replay test did not run green:\n${out.slice(-2500)}`);
      }
      await VSBrowser.instance.openResources(replay);
      await sleep(2000);
      await dismissOverlays();
      await shot("06-generated-replay-test");
      return `${path.basename(replay, ".cs")} ran green (captured context replayed through the plugin in-process)`;
    });
  });

  // The gap these two steps close: everything above proves the replay EXECUTES, not that you can
  // DEBUG it. "F5 a captured production run and stop inside your plugin" is the actual promise of
  // #210, and nothing verified it — that was the last thing resting purely on the manual checklist
  // (#224).
  //
  // Needs the C# extension: the Test Explorer's Debug profile launches `type: "coreclr"`, which
  // ms-dotnettools.csharp contributes. The e2e instance runs a clean extensions dir, so these steps
  // SELF-SKIP unless it was installed (`npm run test:e2e:debugger`) rather than fail — and they say so,
  // so an unproven gap stays visible instead of looking covered.
  it("binds a breakpoint INSIDE the plugin when debugging the replay (needs the C# extension)", async function () {
    if (!csharpExtensionInstalled()) {
      console.log("    [e2e] SKIPPED: ms-dotnettools.csharp is not installed, so the coreclr debug type does not exist — run `npm run test:e2e:debugger`.");
      this.skip();
    }
    await step(COMPONENT, "Debug the replay: breakpoint inside the plugin binds", async () => {
      // Break on the plugin's OWN trace line — reached only if the captured context really flows back
      // through the plugin, which is the whole claim.
      const pluginCs = await waitForMatchDeep(workspace, (n) => n === `${className}.cs`, 30000);
      if (!pluginCs) {
        throw new Error(`${className}.cs not found in the workspace`);
      }
      const lines = fs.readFileSync(pluginCs, "utf8").split(/\r?\n/);
      breakpointLine = lines.findIndex((l) => l.includes("localPluginContext.Trace(")) + 1; // 1-based
      if (breakpointLine < 1) {
        throw new Error("could not find the plugin's Trace line to break on");
      }

      await VSBrowser.instance.openResources(pluginCs);
      await sleep(2500);
      await dismissOverlays();
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { TextEditor, EditorView } = require("vscode-extension-tester");
      // Activate the plugin FILE first: earlier steps open the generated Replay_*.cs, and both
      // breakpoints and CodeLens reads act on whatever editor is active (which is why a
      // breakpoint on line ${breakpointLine} once failed against the much shorter replay file).
      await new EditorView().openEditor(`${className}.cs`).catch(() => undefined);
      await sleep(1500);
      const editor = new TextEditor();
      await editor.toggleBreakpoint(breakpointLine);

      // Debug ALL tests rather than "at cursor": our test items are created without a uri/range, so
      // VS Code cannot resolve a test from a cursor position (see #252). Debug Tests is the button the
      // Testing view actually offers. Only the replay test reaches this breakpoint.
      await shotWithHighlight(".codicon-debug-breakpoint", "07-breakpoint-in-plugin");
      await runCommand("Test: Debug All Tests");

      // A VERIFIED (not hollow) breakpoint proves the test host loaded the plugin's own symbols —
      // the thing that makes debugging a replay possible at all.
      const driver = VSBrowser.instance.driver;
      const boundDeadline = Date.now() + 240000;
      let bound = false;
      while (Date.now() < boundDeadline && !bound) {
        bound = (await driver.executeScript(
          "return document.querySelectorAll('.codicon-debug-breakpoint:not(.codicon-debug-breakpoint-unverified)').length > 0 && document.querySelectorAll('.codicon-debug-breakpoint-unverified').length === 0;",
        )) as boolean;
        if (!bound) {
          await sleep(3000);
        }
      }
      expect(bound, `breakpoint on ${className}.cs:${breakpointLine} VERIFIED (bound) under the debugger`).to.equal(true);
      return `breakpoint bound at ${className}.cs:${breakpointLine} while debugging the replay`;
    });
  });

  it("PAUSES inside the plugin while replaying the captured run, then continues green", async function () {
    if (!csharpExtensionInstalled()) {
      this.skip();
    }
    await step(COMPONENT, "Debug the replay: pauses inside the plugin, then continues", async () => {
      const driver = VSBrowser.instance.driver;
      // The replay feeds the captured context through the plugin, so execution must STOP on the
      // breakpoint set above. The floating debug toolbar's continue icon is the pause signal (the
      // same check the web-resource debug suite uses).
      const pausedDeadline = Date.now() + 240000;
      let paused = false;
      while (Date.now() < pausedDeadline && !paused) {
        paused = (await driver.executeScript("return document.querySelectorAll('.debug-toolbar .codicon-debug-continue').length > 0;")) as boolean;
        if (!paused) {
          await sleep(3000);
        }
      }
      expect(paused, "debugger PAUSED at the breakpoint inside the plugin during replay").to.equal(true);

      await shotWithHighlight(".debug-toolbar .codicon-debug-continue", "08-paused-inside-plugin");
      // Paused WHERE matters: the focused editor must be the plugin's own file, which is what
      // "debug a captured production run" means — not merely that some session stopped somewhere.
      const activeTab = String((await driver.executeScript("return document.querySelector('.tabs-container .tab.active .label-name')?.textContent ?? '';")) ?? "");
      expect(activeTab, `paused inside ${className}.cs (active tab was "${activeTab}")`).to.contain(`${className}.cs`);

      // Log the call stack for diagnosis, without asserting on it — the Run and Debug view may not be
      // the visible side bar, and a brittle DOM assert here would buy nothing over the tab check.
      const stack = String(
        (await driver.executeScript("return Array.from(document.querySelectorAll('.debug-call-stack .monaco-list-row')).map(function(r){return r.textContent;}).join(' | ');")) ??
          "",
      );
      if (stack) {
        console.log(`    [e2e] call stack: ${stack.slice(0, 300)}`);
      }

      // Continue and let the run finish, then clear the breakpoint so nothing pauses later.
      await driver.executeScript(
        "document.querySelector('.debug-toolbar .codicon-debug-continue').closest('a,li,div[role=button],.action-item')?.querySelector('a')?.click() ?? document.querySelector('.debug-toolbar .codicon-debug-continue').click();",
      );
      const endedDeadline = Date.now() + 180000;
      let ended = false;
      while (Date.now() < endedDeadline && !ended) {
        ended = (await driver.executeScript("return document.querySelectorAll('.debug-toolbar').length === 0;")) as boolean;
        if (!ended) {
          await sleep(3000);
        }
      }
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { TextEditor, EditorView } = require("vscode-extension-tester");
      // Activate the plugin FILE first: earlier steps open the generated Replay_*.cs, and both
      // breakpoints and CodeLens reads act on whatever editor is active (which is why a
      // breakpoint on line ${breakpointLine} once failed against the much shorter replay file).
      await new EditorView().openEditor(`${className}.cs`).catch(() => undefined);
      await sleep(1500);
      await new TextEditor().toggleBreakpoint(breakpointLine).catch(() => undefined);
      expect(ended, "debug session ended after continuing").to.equal(true);
      return `paused inside ${className}.cs:${breakpointLine} during replay, continued, session ended`;
    });
  });

  // Drive the CodeLens route for real. Last, so a failure here cannot disturb the capture flow above,
  // and it toggles back OFF so the step is left active for the next run (the #241 lesson).
  it("starts and stops profiling from the per-step CodeLens", async () => {
    await step(COMPONENT, "CodeLens route: start profiling, then stop", async () => {
      const pluginCs = await waitForMatchDeep(workspace, (n) => n === `${className}.cs`, 30000);
      if (!pluginCs) {
        throw new Error(`${className}.cs not found`);
      }
      await VSBrowser.instance.openResources(pluginCs);
      await sleep(3000);
      await dismissOverlays();
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { TextEditor, EditorView } = require("vscode-extension-tester");
      // Activate the plugin FILE first: earlier steps open the generated Replay_*.cs, and both
      // breakpoints and CodeLens reads act on whatever editor is active (which is why a
      // breakpoint on line ${breakpointLine} once failed against the much shorter replay file).
      await new EditorView().openEditor(`${className}.cs`).catch(() => undefined);
      await sleep(1500);

      const clickProfileLens = async (): Promise<string> => {
        const deadline = Date.now() + 90000;
        for (;;) {
          const lenses = await new TextEditor().getCodeLenses();
          for (const lens of lenses) {
            const text = await lens.getText();
            if (/Profile:/.test(text)) {
              await lens.click();
              return text;
            }
          }
          if (Date.now() > deadline) {
            throw new Error("no Profile CodeLens to click");
          }
          await sleep(3000);
        }
      };

      const startBaseline = logFileSize();
      const beforeText = await clickProfileLens();
      // The TOGGLE path logs "Profiling ON" — "Started profiling" belongs to the capture path, and
      // waiting for it timed out while profiling was in fact on (the #240 lesson, again).
      await waitForLogFile("[Profiler] Profiling ON for", { timeoutMs: 180000, sinceByte: startBaseline });
      await sleep(4000);
      await shotWithHighlight(".codelens-decoration a", "09-profile-codelens-on", { text: "Profile:" });

      // Toggling the same lens again stops it. Its on/off label comes from the cached active-profiles
      // list, so a panel refresh may lag the click.
      const stopBaseline = logFileSize();
      await clickProfileLens();
      // Stopping via the lens logs either "Stopped profiling (deleted profiler step)" or "Profiling OFF"
      // depending on which arm ran, so match the shared prefix.
      await waitForLogFile(/\[Profiler\] (Stopped profiling|Profiling OFF)/, { timeoutMs: 180000, sinceByte: stopBaseline });
      // Leave the step ACTIVE however the profiler left it (#241).
      await client.reactivateAssemblySteps(projectName).catch(() => 0);
      return `CodeLens toggled profiling on ("${beforeText.trim()}") and back off`;
    });
  });

  after(async function () {
    // Remove the profiler's clone step FIRST — if the capture didn't reach "Stop Profiling", a
    // "(Profiler)" step keeps firing on Create-of-territory and every territory create in the shared
    // org then 400s. This must run regardless of how the tail failed.
    try {
      const removed = await client.cleanupProfilerSteps("territory");
      if (removed > 0) {
        console.log(`[cleanup] removed ${removed} leftover profiler step(s) on territory`);
      }
    } catch {
      /* best-effort */
    }
    // Then RE-ENABLE the original the profiler deactivated (#241). Deleting the clone was never
    // enough: leaving the original disabled is what made one failed run break every run after it.
    try {
      const reactivated = await client.reactivateAssemblySteps(projectName);
      if (reactivated > 0) {
        console.log(`[cleanup] re-enabled ${reactivated} original step(s) the profiler had disabled`);
      }
    } catch {
      /* best-effort */
    }
    // Delete the captured profiles this run created — otherwise the next run downloads several and
    // "Replay & debug" starts prompting "Replay which profile?" (see deletePluginProfilesForType).
    try {
      const profiles = await client.deletePluginProfilesForType(typeName);
      if (profiles > 0) {
        console.log(`[cleanup] deleted ${profiles} captured profile(s) for ${typeName}`);
      }
    } catch {
      /* best-effort */
    }
    try {
      await client.deletePluginPackage(pkgUnique());
    } catch {
      /* best-effort */
    }
    try {
      if (triggeredTerritoryId) {
        await client.deleteTerritory(triggeredTerritoryId);
      }
    } catch {
      /* best-effort */
    }
  });
});
