import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import { runScopedName, loadE2EEnv, freshWorkspace, answerText, pickByLabel, waitForFile, dismissOverlays, sleep, E2EClient } from "./lib";
import { clickPanelButton, expandComponentCards } from "../supervised/supervisedLib";
import { initProject, step, showLog } from "./acceptanceLib";

// ACCEPTANCE (button-driven, live Dataverse): the real main process for a Plugins project —
// start the project + write a plugin class, build it, then register the step + publish the
// package, and verify the package landed in Dataverse. Everything is driven through the panel's
// own buttons + wizard (no command palette).
const COMPONENT = "Plugin";

/** Any file matching a predicate anywhere under dir (recursive), polled until found or timeout. */
async function waitForMatchDeep(dir: string, predicate: (file: string) => boolean, timeoutMs: number): Promise<string | undefined> {
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
      if (e.isDirectory() && e.name !== "obj") {
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

describe("ACCEPTANCE: Plugin — build, code, register, publish via panel buttons", function () {
  this.timeout(2400000);
  const env = loadE2EEnv();
  let workspace: string;
  let solutionFriendlyName: string;
  let client: E2EClient;
  const projectName = "AcceptancePlugin";
  const packageName = runScopedName("AcceptancePlugin");

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
    workspace = freshWorkspace("acc-plugin");
    await VSBrowser.instance.openResources(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    await showLog();
  });

  it("starts a Plugins project + writes a plugin class (Initialise button + wizard)", async () => {
    await step(COMPONENT, "Write code (new Plugins project + plugin class)", async () => {
      await initProject("Plugins", env!, solutionFriendlyName, async () => {
        await answerText(projectName); // plugin project name
        await answerText(packageName); // plugin package name
        await answerText("1.0.0"); // version
        await pickByLabel("No", 600000); // "set up unit testing?" — pac plugin init + restore run first
        await pickByLabel("Yes", 300000); // "create a plugin class?" — yes (a user needs a plugin type to deploy)
        await answerText("AcceptancePluginClass"); // class name
      });
      const cs = path.join(workspace, projectName, "AcceptancePluginClass.cs");
      expect(await waitForFile(cs, 120000), "plugin class scaffolded").to.equal(true);
      return `wrote ${projectName}/AcceptancePluginClass.cs (scaffolded with a [CrmPluginRegistration] step)`;
    });
  });

  it("builds the project — Local Build button", async () => {
    await step(COMPONENT, "Build (Local Build button → dotnet build)", async () => {
      await expandComponentCards();
      await clickPanelButton("Local Build", { timeoutMs: 30000 });
      const dll = await waitForMatchDeep(path.join(workspace, projectName), (f) => f === `${projectName}.dll`, 300000);
      if (!dll) {
        throw new Error("Local Build produced no compiled assembly");
      }
      return `compiled ${path.relative(workspace, dll)}`;
    });
  });

  it("registers the step + publishes the package — Build & deploy button; verified in Dataverse", async () => {
    await step(COMPONENT, "Register step + publish (Build & deploy package)", async () => {
      await expandComponentCards();
      await clickPanelButton("Build & deploy package", { timeoutMs: 30000, contains: true }); // primary button has a "▶ " prefix
      // dotnet build + pack + upsert plugin package + register steps + publish — poll Dataverse for it.
      let id: string | undefined;
      const deadline = Date.now() + 420000;
      do {
        try {
          id = await client.findPluginPackageId(pkgUnique());
        } catch {
          /* transient network */
        }
        if (id) {
          break;
        }
        await sleep(6000);
      } while (Date.now() < deadline);
      if (!id) {
        throw new Error(`plugin package ${pkgUnique()} not found in Dataverse after deploy`);
      }
      return `plugin package ${pkgUnique()} present in Dataverse (id ${id})`;
    });
  });

  after(async function () {
    try {
      await client.deletePluginPackage(pkgUnique());
    } catch {
      /* best-effort cleanup */
    }
  });
});
