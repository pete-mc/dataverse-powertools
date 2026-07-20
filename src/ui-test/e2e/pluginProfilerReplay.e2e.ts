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
  E2EClient,
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
//   Replay & debug    → generates Replay_<Type>_<stamp>.cs;
//   dotnet build      → the generated replay test COMPILES (the profiler + Microsoft.Xrm.Sdk refs are
//                       wired). This end-to-end proves profiling now works for the extension's PACKAGE
//                       plugins (#208). RUNNING the replay green needs the profiler replay runtime's
//                       full dependency closure in the test host — a tracked follow-up.
// The click window is gated on the extension's log FILE (waitForLogFile), not Selenium polling, so
// the session survives on the 8GB VM. Self-skips off Windows and without live creds. See TESTING.md.
const COMPONENT = "Plugin";
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
      const logBaseline = logFileSize();
      await clickPanelButton("Profile next run", { timeoutMs: 30000 });
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
      await pushModalButton("Continue");
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
      await clickPanelButton("Replay & debug", { timeoutMs: 30000 });
      const replay = await waitForMatchDeep(workspace, (n) => /^Replay_.*\.cs$/.test(n), 120000);
      if (!replay) {
        throw new Error("no Replay_*.cs generated in the test project");
      }
      return `generated ${path.relative(workspace, replay)}`;
    });
  });

  it("compiles the generated replay test — dotnet build the test project (Xrm.Sdk reference wired)", async () => {
    await step(COMPONENT, "Compile replay test (dotnet build the test project)", async () => {
      const replay = await waitForMatchDeep(workspace, (n) => /^Replay_.*\.cs$/.test(n), 30000);
      const testCsproj = await waitForMatchDeep(workspace, (n) => n === `${projectName}.Tests.csproj`, 30000);
      if (!replay || !testCsproj) {
        throw new Error("replay test or test project missing");
      }
      // Build (not run) the test project: this exercises the generation's csproj wiring — including the
      // Microsoft.Xrm.Sdk compile reference the profiler Replay signature needs (CS0012 otherwise).
      // RUNNING the replay green needs the profiler replay runtime's full dependency closure in the
      // test output (Xrm.Sdk / Crm.Sdk.Proxy / PluginProfiler.* at the versions the engine binds to),
      // which is tracked separately (#208 follow-up) — capture → download → replay-generation, the
      // proof that profiling now works for package plugins, is what this suite asserts end to end.
      const res = spawnSync("dotnet", ["build", testCsproj, "--nologo", "-v", "minimal"], { cwd: workspace, encoding: "utf8", timeout: 600000, shell: false });
      const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
      if (res.status !== 0 || /error CS\d+/.test(out)) {
        throw new Error(`replay test did not compile:\n${out.slice(-2000)}`);
      }
      return `${path.basename(replay, ".cs")} compiled (test project builds with the profiler + Xrm.Sdk references)`;
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
