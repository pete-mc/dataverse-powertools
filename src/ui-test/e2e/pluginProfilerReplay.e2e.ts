import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import { loadE2EEnv, freshWorkspace, answerText, pickByLabel, waitForFile, dismissOverlays, sleep, waitForLogFile, logFileSize, E2EClient } from "./lib";
import { clickPanelButton, expandComponentCards } from "../supervised/supervisedLib";
import { initProject, step, showLog } from "./acceptanceLib";

// DEBUGGING e2e (button-driven, live Dataverse, WINDOWS-ONLY) for the plugin Debugging block. It
// deploys a plugin registered on Create-of-territory, proves the getProfilableSteps $top=200 fix
// finds the step in a busy org, and asserts the profiler-capture GUARD: because the extension
// deploys plugins as PACKAGES and the Plugin Profiler can only snapshot classic (non-package)
// assemblies (it reads `pluginassembly.content`, which is NULL for packages → the server-side
// profiler throws "Unexpected Exception in the Plug-in Profiler" and leaves a broken step firing),
// "Profile next run" must REFUSE with a clear message rather than enable a doomed capture. That
// refusal — not a captured→replayed profile — is the honest, green end state on the current
// (package) deploy + profiler. Self-skips off Windows and without live creds. See TESTING.md and the
// profiler-capture memory; the deeper "make profiling work for package plugins" question is a
// separate follow-up (tracked on GitHub).
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
 *  matters: the Plugin Profiler in persist-to-entity mode saves the profile and then throws to skip
 *  the original plugin; on a SYNCHRONOUS step that throw is inside the create's transaction, so it
 *  rolls the persisted profile back (0 profiles) AND fails the create ("Unexpected Exception in the
 *  Plug-in Profiler", 400). An ASYNC step runs in its own transaction — the create returns 204 and
 *  the profile commits. The namespace/class must match the scaffolded file so `Build & deploy`
 *  discovers the [CrmPluginRegistration]. */
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

  it("Profile next run REFUSES a package-deployed step with a clear message (not a cryptic profiler crash)", async () => {
    await step(COMPONENT, "Profiler refuses package-deployed plugin (clear message)", async () => {
      // The extension deploys plugins as PACKAGES; the Plugin Profiler snapshots the assembly from
      // `pluginassembly.content`, which is NULL for package assemblies — so enabling profiling makes
      // the server-side profiler throw "Unexpected Exception in the Plug-in Profiler" on every trigger
      // AND leaves a broken profiler step firing on the entity (the async job's inner error is
      // `Convert.FromBase64String(null)` in `PluginLoaderUtility.RefreshAssembly`). The extension now
      // detects this up front and explains instead of enabling a doomed capture. Assert that via the
      // extension's OWN log line (mirrored to a FILE — no WebDriver polling across the click, which is
      // what lost the Selenium session on the 8GB VM before).
      await expandComponentCards();
      const logBaseline = logFileSize();
      await clickPanelButton("Profile next run", { timeoutMs: 30000 });
      const tail = await waitForLogFile(/\[Profiler\] Skipped: assembly .* is package-deployed/, { timeoutMs: 120000, sinceByte: logBaseline });
      // And it must NOT have enabled profiling (no "Started profiling", no leftover profiler step).
      if (/\[Profiler\] Started profiling/.test(tail)) {
        throw new Error("profiler enabled on a package-deployed step — the package guard did not fire");
      }
      const left = await client.cleanupProfilerSteps("territory").catch(() => 0);
      if (left > 0) {
        throw new Error(`the package guard did not fire — ${left} profiler step(s) were created on territory`);
      }
      return `profiler correctly refused the package-deployed step for ${typeName} (no enable, no broken profiler step)`;
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
  });
});
