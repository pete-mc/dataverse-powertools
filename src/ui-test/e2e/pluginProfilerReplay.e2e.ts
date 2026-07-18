import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import { loadE2EEnv, freshWorkspace, answerText, pickByLabel, waitForFile, dismissOverlays, sleep, waitForModal, pushModalButton, pickManyByLabel, E2EClient } from "./lib";
import { clickPanelButton, expandComponentCards } from "../supervised/supervisedLib";
import { initProject, step, showLog } from "./acceptanceLib";

// DEBUGGING e2e (button-driven, live Dataverse, WINDOWS-ONLY): the real plugin "capture → replay →
// execute" loop through the panel's Debugging block. Deploys a plugin registered on Create-of-
// territory, clicks "Profile next run" to Start Profiling the step, TRIGGERS it via the Web API (a
// throwaway territory create) at the modal "Continue" prompt, downloads the captured profile, then
// "Replay & debug" generates a replay unit test — which is finally BUILT + RUN with `dotnet test`
// and asserted green. That green run is the debugging payoff: the captured production context is
// re-executed against the plugin locally. Capture is a net48 tool, so the whole suite self-skips off
// Windows (and without live creds). Mirrors the manual proof behind #63 / task #77.
const COMPONENT = "Plugin";
const isWindows = process.platform === "win32";
// The capture TAIL (Profile next run modal → live trigger → download → replay → dotnet-test-to-green)
// drives a VS Code MODAL dialog through ExTester. On the shared 8GB e2e VM this is unreliable: the
// sustained Selenium poll for the modal loses the driver session ("invalid session id") — the
// extension host stays healthy, but the harness connection drops. The reliable portion (scaffold →
// write → build & deploy → the step is discoverable as PROFILABLE) runs by default and covers the
// getProfilableSteps $top=200 fix end-to-end; set DVPT_E2E_PROFILER_CAPTURE=1 (on a roomier VM) to
// also run the modal-driven tail. See TESTING.md / the profiler-capture memory.
const runCaptureTail = process.env.DVPT_E2E_PROFILER_CAPTURE === "1";
const tailIt = runCaptureTail ? it : it.skip;

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

/** A plugin registered on Create-of-territory (Post, Sync, Sandbox) that traces the target — a
 *  Web-API-creatable table so the trigger is deterministic, and small enough to replay green. The
 *  namespace/class must match the scaffolded file so `Build & deploy` discovers the [CrmPluginRegistration]. */
function territoryPluginSource(namespaceName: string, className: string): string {
  return `using Microsoft.Xrm.Sdk;
using System;

namespace ${namespaceName}
{
    [CrmPluginRegistration(MessageNameEnum.Create, "territory", StageEnum.PostOperation, ExecutionModeEnum.Synchronous, "", "Create territory (DVPT profiler e2e)", 1, IsolationModeEnum.Sandbox)]
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
      return `wrote ${projectName}/${className}.cs — [CrmPluginRegistration(Create, territory, Post, Sync)] type ${typeName}`;
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

  tailIt("captures a real run — Profile next run → trigger via Web API → Continue → download", async () => {
    await step(COMPONENT, "Capture a production run (Profile next run + live trigger)", async () => {
      // Reclaim RAM before capture. The just-finished `Build & deploy` ran dotnet build + pack,
      // which leaves MSBuild/VBCSCompiler build-server processes resident. On the 8GB VM, the net48
      // profiler tool spawning on top of them can OOM-crash the VS Code host mid-capture (Selenium
      // then reports "invalid session id"). Shutting the build servers down frees ~1GB first.
      try {
        spawnSync("dotnet", ["build-server", "shutdown"], { encoding: "utf8", timeout: 60000, shell: false });
      } catch {
        /* best-effort */
      }
      await sleep(4000);
      await expandComponentCards();
      await clickPanelButton("Profile next run", { timeoutMs: 30000 });
      // The capture shows its modal ONLY AFTER profiling is enabled (and after a possible one-time,
      // slow managed-solution install). Wait for the modal FIRST — its presence proves the step is
      // now profiling — THEN fire the trigger, so we can never create the territory before the
      // profiler is armed (a fixed sleep would race the install/enable). The profiler solution is
      // already installed in the test env, so enabling is quick — a shorter wait fails fast (with a
      // clear error) if the step never became profilable instead of idling until the session dies.
      await waitForModal(240000);
      triggeredTerritoryId = await client.createTerritory();
      if (!triggeredTerritoryId) {
        throw new Error("could not create a territory to trigger the plugin");
      }
      await sleep(10000); // sync PostOperation step fires + profiler persists the mbs_pluginprofile
      await pushModalButton("Continue", 60000);
      // downloadPluginProfiles shows a canPickMany picker of the env's captured profiles — pick ours.
      await pickManyByLabel(className, 60000);
      const profilesDir = path.join(workspace, projectName, "profiles");
      const gotProfile = await waitForMatchDeep(profilesDir, (n) => n.includes(".profile"), 120000);
      // Best-effort org-side assertion the capture actually persisted.
      const captured = await client.hasPluginProfileForType(typeName).catch(() => false);
      if (!gotProfile) {
        throw new Error(`no .profile downloaded into ${path.relative(workspace, profilesDir)} (org captured=${captured})`);
      }
      return `captured + downloaded ${path.basename(gotProfile)} (org profile for ${typeName}=${captured})`;
    });
  });

  tailIt("generates a replay test — Replay & debug", async () => {
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

  tailIt("executes the replay — dotnet test the generated test to GREEN (production context re-run)", async () => {
    await step(COMPONENT, "Execute replay (dotnet test the generated test)", async () => {
      const replay = await waitForMatchDeep(workspace, (n) => /^Replay_.*\.cs$/.test(n), 30000);
      const testCsproj = await waitForMatchDeep(workspace, (n) => n === `${projectName}.Tests.csproj`, 30000);
      if (!replay || !testCsproj) {
        throw new Error("replay test or test project missing");
      }
      const replayClass = path.basename(replay, ".cs");
      const res = spawnSync("dotnet", ["test", testCsproj, "--filter", `FullyQualifiedName~${replayClass}`, "--nologo", "-v", "minimal"], {
        cwd: workspace,
        encoding: "utf8",
        timeout: 900000,
        shell: false,
      });
      const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
      if (res.status !== 0) {
        throw new Error(`dotnet test failed (exit ${res.status}) for ${replayClass}:\n${out.slice(-2000)}`);
      }
      const passed = /Passed!\s*-\s*Failed:\s*0/.test(out) || /\bPassed!\b/.test(out);
      if (!passed) {
        throw new Error(`replay test did not report a pass:\n${out.slice(-2000)}`);
      }
      return `${replayClass} executed GREEN — captured territory-create context replayed locally`;
    });
  });

  after(async function () {
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
