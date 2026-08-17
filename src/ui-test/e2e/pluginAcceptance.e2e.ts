import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import {
  runScopedName,
  loadE2EEnv,
  freshWorkspace,
  openWorkspaceFolder,
  answerText,
  pickByLabel,
  waitForFile,
  dismissOverlays,
  sleep,
  expectOutput,
  clearOutput,
  E2EClient,
} from "./lib";
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
    await openWorkspaceFolder(workspace);
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

  // Ported from pluginLifecycle when that suite was retired as a duplicate (#143 Move 4): it was the
  // ONLY place early-bound generation was proved, and the build below is what proves the generated
  // classes actually compile into the package (#130) — a csproj that stopped globbing
  // ..\generated\**\*.cs would fail there, not here.
  it("generates early-bound classes — Generate Earlybound button (#129/#130)", async () => {
    await step(COMPONENT, "Generate early-bound classes", async () => {
      // Seed modelbuilder.json so the command runs `pac modelbuilder` directly instead of opening the
      // config wizard, which has no business being in an acceptance path.
      fs.writeFileSync(
        path.join(workspace, "modelbuilder.json"),
        JSON.stringify({ namespace: "Dataverse.Plugins", serviceContextName: "XrmSvc", outputDirectory: "generated" }, null, 2),
        "utf8",
      );

      await clearOutput();
      await expandComponentCards();
      await clickPanelButton("Generate Earlybound", { timeoutMs: 45000 });
      await expectOutput("Plugin early bound generation complete.", {
        timeoutMs: 300000,
        failMarkers: ["Error running pac modelbuilder", "pac authentication failed", "No active environment"],
        step: "generate early bound",
      });

      // The log line is the command's own claim; the files are the fact. `pac` exits 0 on failure, which
      // is how early-bound once reported success with nothing generated (#129).
      const generatedDir = path.join(workspace, "generated");
      const deadline = Date.now() + 30000;
      let generated: string[] = [];
      do {
        try {
          generated = fs.existsSync(generatedDir) ? fs.readdirSync(generatedDir).filter((name) => name.toLowerCase().endsWith(".cs")) : [];
        } catch {
          generated = [];
        }
        if (generated.length > 0) {
          break;
        }
        await sleep(2000);
      } while (Date.now() < deadline);
      expect(generated.length, "generated/*.cs written by pac modelbuilder").to.be.greaterThan(0);
      return `generated ${generated.length} early-bound file(s) into generated/`;
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
