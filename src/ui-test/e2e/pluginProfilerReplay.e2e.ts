import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import {
  openWorkspaceFolder,
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
  runCommandResilient,
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
//   Generate Replay Test → writes Replay_<Type>_<stamp>.cs + the in-process DvptReplay harness;
//   Replay & debug    → RUNS that replay under the debugger (VSTEST_HOST_DEBUG + clr attach), so a
//                       breakpoint inside the plugin is hit;
//   dotnet test       → the generated replay RUNS GREEN (#210): the in-process harness deserializes the
//                       captured .profile into an IPluginExecutionContext and re-executes the real
//                       plugin against it — no child AppDomain, so it actually runs in the test host.
//                       This end-to-end proves profiling now works for the extension's PACKAGE plugins
//                       (#208) AND that a captured run replays back through the plugin (#210).
// The click window is gated on the extension's log FILE (waitForLogFile), not Selenium polling, so
// the session survives on a small box. Self-skips without live creds. See TESTING.md.
//
// This suite used to self-skip off Windows too, because the scaffolded test project targeted .NET
// Framework: `dotnet test` needed a Framework test host, and the debugger had to attach with `clr`.
// #269 removed both — the plug-in multi-targets net462;net8.0, so the test project is net8.0 and
// `debugTypeForFramework` resolves to `coreclr`. The DEBUG steps still self-skip without the C#
// extension (`npm run test:e2e:debugger` installs it), on every OS, because `coreclr` is the type
// IT contributes.
const COMPONENT = "Plugin";
let breakpointLine = 0;

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

/** The plugin this suite profiles, replays and debugs. Registered on Create-of-territory (Post, ASYNC,
 *  Sandbox): a Web-API-creatable table, so the trigger is deterministic.
 *
 *  It is deliberately shaped like a plugin someone would actually write — validate the input, derive
 *  values from it, trace the outcome — for two reasons. It gives the breakpoint somewhere WORTH
 *  stopping (`name` and `region` in Locals, a call stack through two of its own methods), and these
 *  screenshots are published in the wiki walkthrough, where a probe that only traces an id teaches
 *  nobody anything.
 *
 *  It stays free of IOrganizationService calls on purpose: the replay re-executes it in-process against
 *  the captured context with no live org, so anything that needed a service round-trip could not run.
 *  ASYNC keeps the test simple — the create returns 204 immediately and the profiler runs in a
 *  background job, so the test never reasons about the trigger's own response.
 *  The namespace/class must match the scaffolded file so `Build & deploy` finds the
 *  [CrmPluginRegistration]. */
function territoryPluginSource(namespaceName: string, className: string): string {
  return `using Microsoft.Xrm.Sdk;
using System;

namespace ${namespaceName}
{
    /// <summary>
    /// Onboards a new territory: validates the name, derives the sales region and the territory code
    /// from it, and traces what it worked out.
    /// </summary>
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
            if (!context.InputParameters.Contains("Target") || !(context.InputParameters["Target"] is Entity target))
            {
                return;
            }

            var name = target.GetAttributeValue<string>("name");
            if (string.IsNullOrWhiteSpace(name))
            {
                throw new InvalidPluginExecutionException("A territory must have a name before it can be onboarded.");
            }

            var region = ResolveSalesRegion(name);
            var code = BuildTerritoryCode(name, region);

            localPluginContext.Trace("Onboarded territory '" + name + "' as " + code + " in the " + region + " region.");
        }

        /// <summary>Which sales region a territory belongs to, from its name.</summary>
        private static string ResolveSalesRegion(string name)
        {
            var lowered = name.ToLowerInvariant();
            if (lowered.Contains("north"))
            {
                return "North";
            }

            if (lowered.Contains("south"))
            {
                return "South";
            }

            return "Central";
        }

        /// <summary>The territory code: region initial + the first three letters of the name.</summary>
        private static string BuildTerritoryCode(string name, string region)
        {
            var letters = new string(Array.FindAll(name.ToCharArray(), char.IsLetter));
            var stem = letters.Length >= 3 ? letters.Substring(0, 3) : letters;
            return (region.Substring(0, 1) + "-" + stem).ToUpperInvariant();
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
  // Named like a project someone would really have: these names appear in the wiki walkthrough's
  // screenshots, and "ProfilerE2E/ProfilerProbe" told the reader nothing except that it was a test.
  const projectName = "ContosoTerritories";
  const packageName = "ContosoTerritories";
  const className = "TerritoryOnboarding";
  let typeName = `${projectName}.${className}`; // refined from the scaffolded file's real namespace
  let triggeredTerritoryId: string | undefined;
  /** The second trigger, fired with tracing ON so the viewer has a real row to show (#231). */
  let tracedTerritoryId: string | undefined;

  function pkgUnique(): string {
    const settings = JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8"));
    return `${settings.prefix ?? env?.prefix}_${packageName}`;
  }

  before(async function () {
    if (!env) {
      this.skip();
    }
    client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;
    workspace = freshWorkspace("dbg-profiler");
    await openWorkspaceFolder(workspace);
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
      // Close everything first: the wizard opened the SCAFFOLDED version of this file (no
      // [CrmPluginRegistration] yet — the suite writes the real source afterwards), and that stale buffer
      // is what the lens provider read, so the lenses came back as "Add Class Decoration". Reopening from
      // disk with no other editors around is deterministic.
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { TextEditor, EditorView } = require("vscode-extension-tester");
      await new EditorView().closeAllEditors().catch(() => undefined);
      await sleep(1000);
      await VSBrowser.instance.openResources(pluginCs);
      await sleep(3000);
      await dismissOverlays();
      // Activate the plugin FILE first: earlier steps open the generated Replay_*.cs, and both
      // breakpoints and CodeLens reads act on whatever editor is active (which is why a
      // breakpoint on line ${breakpointLine} once failed against the much shorter replay file).
      await new EditorView().openEditor(`${className}.cs`).catch(() => undefined);
      await sleep(1500);
      const titles: string[] = [];
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        try {
          const editor = new TextEditor();
          // Scroll to the TOP every attempt. The Profile lens sits above the [CrmPluginRegistration]
          // near line 1 and getCodeLenses() only sees RENDERED decorations, so a scrolled-down editor
          // reports the lenses of whatever is on screen instead — that is how this read once "saw"
          // only `2 references | Dataverse: Add Class Decoration` and failed.
          await editor.moveCursor(1, 1).catch(() => undefined);
          await sleep(700);
          const lenses = await editor.getCodeLenses();
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

  it("generates a replay test — Generate Replay Test", async () => {
    await step(COMPONENT, "Generate replay test (Generate Replay Test)", async () => {
      await expandComponentCards();
      // "Generate Replay Test" WRITES the test; "Replay & debug" now runs it under the debugger, which
      // the debug steps below exercise.
      await clickPanelButton("Generate Replay Test", { timeoutMs: 30000, shot: "05-generate-replay-test-button" });
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
      // Break where the plugin DERIVES something, not on its trace line: paused here, Locals hold the
      // captured `target`, the `name` off it and the `region` just computed — which is the point of
      // replaying a real run, and what the wiki screenshot needs to show.
      breakpointLine = lines.findIndex((l) => l.includes("var code = BuildTerritoryCode(")) + 1; // 1-based
      if (breakpointLine < 1) {
        throw new Error("could not find the plugin line to break on (var code = BuildTerritoryCode)");
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
      // SCROLL the target line into view first. toggleBreakpoint clicks the gutter by finding the
      // line-number element, and only RENDERED lines exist in the DOM — with the output panel taking the
      // bottom half of the window barely 21 lines show, so a breakpoint on line ~24 failed with
      // NoSuchElementError. Moving the cursor there scrolls it in.
      await editor.moveCursor(breakpointLine, 1);
      await sleep(800);
      await editor.toggleBreakpoint(breakpointLine);

      await shotWithHighlight(".codicon-debug-breakpoint", "07-breakpoint-in-plugin");
      // Drive the PRODUCT's own button. "Replay & debug" runs the replay with VSTEST_HOST_DEBUG and
      // attaches to the waiting test host with the `clr` adapter — the two things that make a breakpoint
      // inside the plugin actually pause, and both of which the old Test-Explorer Debug profile got
      // wrong (coreclr, attached to the `dotnet test` driver instead of the testhost).
      await expandComponentCards();
      await clickPanelButton("Replay & debug", { timeoutMs: 30000, shot: "08-replay-and-debug-button" });

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

  it("PAUSES inside the plugin while replaying the captured run, with the captured context in scope", async function () {
    if (!csharpExtensionInstalled()) {
      this.skip();
    }
    await step(COMPONENT, "Debug the replay: pauses inside the plugin with the captured context", async () => {
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

      await shotWithHighlight(".debug-toolbar .codicon-debug-continue", "09-paused-inside-plugin");
      // A second, un-highlighted frame of the same moment: the wiki needs one that shows WHAT you get
      // when it stops — the captured Target and the values derived from it in Locals, and a call stack
      // running from the test host into the plugin's own methods.
      //
      // The VARIABLES view starts with its scopes COLLAPSED, so a naive capture here is an empty pane
      // under a caption promising the captured values — expand the scopes and prove at least one real
      // variable is on screen before shooting, so the frame cannot silently become a lie.
      const localsVisible = await (async (): Promise<boolean> => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          try {
            await driver.executeScript(
              `for (const row of document.querySelectorAll('.debug-variables .monaco-list-row[aria-expanded="false"], .debug-pane .monaco-list-row[aria-expanded="false"]')) {
                 const twistie = row.querySelector('.monaco-tl-twistie');
                 if (twistie) { twistie.click(); }
               }`,
            );
          } catch {
            /* the view may re-render mid-expand; the retry covers it */
          }
          await sleep(1200);
          const names = String(
            (await driver.executeScript(
              `return Array.from(document.querySelectorAll('.debug-variables .monaco-list-row, .debug-pane .monaco-list-row')).map(function(r){return r.textContent || "";}).join(" | ");`,
            )) ?? "",
          );
          // `target` is the captured Target entity — the whole point of the frame.
          if (/\btarget\b|localPluginContext/i.test(names)) {
            return true;
          }
        }
        return false;
      })();
      if (!localsVisible) {
        console.log("    [e2e] NOTE: Locals did not populate, so 09b shows the call stack only — do not caption it as showing Locals.");
      }
      await shot("09b-locals-and-call-stack");
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

      // NOT ASSERTED HERE: pressing Continue and watching the replay finish green.
      //
      // Every way of delivering Continue to a paused window from Selenium was tried and none of them
      // reached VS Code: a synthetic `element.click()` (Monaco action items want pointer events), a real
      // Selenium click (the mouse-move first renders the "Continue (F5)" tooltip, which then swallows the
      // click — visible in the failure screenshot), the command palette, and F5 via `sendKeys` after
      // reclaiming focus. The session sat paused at the same line each time. That is a keystroke-delivery
      // limit of the harness, not a product defect: what the product must do — attach the right debugger
      // to the right process and STOP inside the plug-in — is asserted above, and that the replay runs to
      // completion GREEN is asserted by the plain `dotnet test` step earlier in this suite.
      //
      // So end the session deterministically instead, and assert the process really did exit.
      const stopBaseline = logFileSize();
      await runCommandResilient("Debug: Stop").catch(() => undefined);
      const finished = await waitForLogFile(/\[Profiler\] Replay finished \(exit code /, { timeoutMs: 120000, sinceByte: stopBaseline });
      expect(/Replay finished/.test(finished), "the replay process exited once the debug session ended").to.equal(true);
      // Log whether the toolbar went away, but don't assert on it: the process exiting is the claim (and
      // is asserted above), while the toolbar is UI chrome that can linger after the session is gone.
      const endedDeadline = Date.now() + 30000;
      let ended = false;
      while (Date.now() < endedDeadline && !ended) {
        ended = (await driver.executeScript("return document.querySelectorAll('.debug-toolbar').length === 0;")) as boolean;
        if (!ended) {
          await sleep(3000);
        }
      }
      console.log(`    [e2e] debug toolbar cleared: ${ended}`);
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { TextEditor, EditorView } = require("vscode-extension-tester");
      // Activate the plugin FILE first: earlier steps open the generated Replay_*.cs, and both
      // breakpoints and CodeLens reads act on whatever editor is active (which is why a
      // breakpoint on line ${breakpointLine} once failed against the much shorter replay file).
      await new EditorView().openEditor(`${className}.cs`).catch(() => undefined);
      await sleep(1500);
      await new TextEditor().moveCursor(breakpointLine, 1).catch(() => undefined);
      await new TextEditor().toggleBreakpoint(breakpointLine).catch(() => undefined);
      return `paused inside ${className}.cs:${breakpointLine} during replay (captured context in scope); session stopped and the replay process exited`;
    });
  });

  // #231 wanted a LIVE-TRIGGERED trace log: not a hand-made example, but the record a real execution
  // wrote. The territory create above already ran the plug-in, and its Trace() line is in the org — so
  // this opens the viewer on that record and captures what a user would read.
  it("shows the trace log written by the run we triggered (live trace capture)", async () => {
    await step(COMPONENT, "View plugin trace logs for the triggered run", async () => {
      // Plug-in tracing is OFF by default, so the earlier trigger wrote no plugintracelog row and the
      // viewer had nothing to show. Turn it on, fire the plug-in again, THEN look — a trace log is only
      // worth capturing if it came from a real execution.
      await runCommandResilient("Dataverse PowerTools: Set Plugin Trace Log Level");
      await pickByLabel("All", 60000);
      await pushModalButton("Set to All").catch(() => undefined); // the firehose confirmation
      // Generous, because these last two tests run at the END of a full e2e run — an hour in, on an 8GB
      // box, against a busy org. Both timed out there while passing comfortably in isolation, and in one
      // case the line arrived just after the deadline: a slow environment, not a broken command.
      await waitForLogFile("[Trace] Plug-in trace log level set to 2", { timeoutMs: 300000 });

      tracedTerritoryId = await client.createTerritory();
      if (!tracedTerritoryId) {
        throw new Error("could not create a territory to trigger the plugin for its trace log");
      }
      // The step is ASYNC, so the row appears a moment after the create returns.
      const wroteTrace = await (async (): Promise<boolean> => {
        const deadline = Date.now() + 180000;
        for (;;) {
          if (await client.hasTraceLogFor(typeName).catch(() => false)) {
            return true;
          }
          if (Date.now() > deadline) {
            return false;
          }
          await sleep(5000);
        }
      })();
      expect(wroteTrace, `a plugintracelog row for ${typeName} after triggering with tracing on`).to.equal(true);

      await runCommandResilient("Dataverse PowerTools: View Plugin Trace Logs");
      // Pick OUR plug-in's log, not the first one. A territory create can fire more than one registered
      // plug-in (an older package from a previous run was still active in the shared org), so "newest
      // first" is not the same as "ours" — the first attempt captured a different plug-in's trace.
      await pickByLabel(className, 120000);
      await sleep(3000);
      await dismissOverlays();
      // Read the DOCUMENT, not the DOM: Monaco renders only the visible lines, so scraping innerText
      // returned the header plus a column of line numbers while the trace body sat below the fold.
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { TextEditor } = require("vscode-extension-tester");
      const rendered = await new TextEditor().getText();
      await shot("10-live-trace-log");
      // TIDY BEFORE ASSERTING. The trace document is an untitled markdown editor, and leaving it active
      // made the NEXT test ask it for CodeLenses and find none — so a failure here cascaded into a
      // second, unrelated-looking failure. Cleanup must not depend on the assertions passing.
      // REVERT and close. The viewer opens the log as an UNTITLED document, which VS Code considers
      // dirty, so a plain "Close Editor" raises a "save your changes?" modal — the suite then sat on
      // that dialog until the hour-long mocha timeout killed the session, and the next test reported a
      // dead driver. Reverting discards without asking; the modal dismissal is belt and braces.
      await runCommandResilient("View: Revert and Close Editor").catch(() => undefined);
      await sleep(1500);
      await pushModalButton("Don't Save").catch(() => undefined);
      await sleep(500);
      // Prove it is OUR run's trace before publishing the frame: the plug-in's own Trace() output.
      expect(rendered, `the trace log is from the plug-in we triggered — saw: ${rendered.slice(0, 200)}`).to.contain("Onboarded territory");
      expect(rendered, "the trace log names the plug-in type that wrote it").to.contain(typeName);
      // Put the firehose back — the docs tell users to, and leaving it on costs the shared org.
      await runCommandResilient("Dataverse PowerTools: Set Plugin Trace Log Level").catch(() => undefined);
      await pickByLabel("Off", 60000).catch(() => undefined);
      return "opened the trace log for the triggered run (contains the plug-in's own Trace output)";
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
      // Start from a known window. Inheriting the debug step's state — a live session, the Run and Debug
      // side bar, the generated Replay_*.cs alongside this file — is what made every CodeLens read here
      // throw "Waiting until element is visible": close everything, then open ONE editor.
      await runCommandResilient("Debug: Stop").catch(() => undefined);
      await sleep(1500);
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { EditorView: Editors } = require("vscode-extension-tester");
      await new Editors().closeAllEditors().catch(() => undefined);
      await sleep(1000);
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
        let lastError = "";
        for (;;) {
          // Tolerate a transient read: right after a debug session ends the editor can hold a stale,
          // zero-size `.codelens-decoration`, and ExTester's visibility wait then throws
          // ("Waiting until element is visible") instead of returning an empty list. That is a retry,
          // not a verdict — the poll below decides.
          try {
            // Scroll to the TOP first. The Profile lens sits above the [CrmPluginRegistration] attribute
            // near line 1, getCodeLenses() only sees RENDERED decorations, and the breakpoint steps left
            // the editor scrolled down at line ~38 — so the lens existed and was simply off-screen.
            await new TextEditor().moveCursor(1, 1).catch(() => undefined);
            await sleep(700);
            const lenses = await new TextEditor().getCodeLenses();
            for (const lens of lenses) {
              const text = await lens.getText();
              if (/Profile:/.test(text)) {
                await lens.click();
                return text;
              }
            }
          } catch (error) {
            lastError = (error as Error).message;
          }
          if (Date.now() > deadline) {
            throw new Error(`no Profile CodeLens to click${lastError ? ` (last read: ${lastError})` : ""}`);
          }
          await sleep(3000);
        }
      };

      const startBaseline = logFileSize();
      const beforeText = await clickProfileLens();
      // The TOGGLE path logs "Profiling ON" — "Started profiling" belongs to the capture path, and
      // waiting for it timed out while profiling was in fact on (the #240 lesson, again).
      // See the note on the trace-level wait above: at the tail of a full run this line arrived at ~3
      // minutes, just past the old 180s deadline.
      await waitForLogFile("[Profiler] Profiling ON for", { timeoutMs: 360000, sinceByte: startBaseline });
      // The LABEL must flip, not just the org state: a lens that still reads "Profile: Off" while
      // profiling is on is the half of #251 you could actually see, and it needed the provider to fire
      // onDidChangeCodeLenses after the toggle settles. Assert it before the screenshot — the previous
      // frame published as "Profile: On" was showing "Off".
      const labelDeadline = Date.now() + 90000;
      let onLabel = "";
      while (Date.now() < labelDeadline && !onLabel) {
        try {
          const editor = new TextEditor();
          await editor.moveCursor(1, 1).catch(() => undefined);
          await sleep(700);
          for (const lens of await editor.getCodeLenses()) {
            const text = await lens.getText();
            if (/Profile:\s*On/.test(text)) {
              onLabel = text;
              break;
            }
          }
        } catch {
          /* transient read — the poll decides */
        }
        if (!onLabel) {
          await sleep(3000);
        }
      }
      expect(onLabel, 'the CodeLens label flipped to "Profile: On" while profiling is on').to.match(/Profile:\s*On/);
      await shotWithHighlight(".codelens-decoration a", "09-profile-codelens-on", { text: "Profile: On" });

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
      // The second trigger, fired with tracing on for the trace-log capture (#231).
      if (tracedTerritoryId) {
        await client.deleteTerritory(tracedTerritoryId);
      }
    } catch {
      /* best-effort */
    }
    // Never leave the org's trace level on All — it is a shared environment and this is a firehose.
    try {
      await client.setTraceLogLevel(0);
    } catch {
      /* best-effort */
    }
  });
});
