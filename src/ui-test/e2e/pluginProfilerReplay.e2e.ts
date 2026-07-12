import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { expect } from "chai";
import { VSBrowser, InputBox } from "vscode-extension-tester";
import { loadE2EEnv, freshWorkspace, answerText, answerFlexible, pickByLabel, runCommand, runCommandResilient, waitForFile, dismissOverlays, sleep, E2EClient } from "./lib";
import { resetAllCredentials } from "./lib";

// #114 / #63 end-to-end: the FULL profiler chain — deploy a plugin with a real
// step, Profile a step… (rails), trigger it via the Web API, the capture lands
// in mbs_pluginprofile, Download Captured Profiles, Stop profiling (byte-
// restore), Replay profile as unit test, and `dotnet test` runs the generated
// replay GREEN (the plugin's Execute runs in-process). Self-skips without creds.
describe("Plugin profiler capture → replay (e2e)", function () {
  this.timeout(1800000);
  const env = loadE2EEnv();
  const projectName = "E2EProfPlugin";
  const packageName = "E2EProfPluginPkg";
  const className = "E2EProfiledPlugin";
  let workspace: string;
  let solutionFriendlyName: string;
  let triggeredTerritoryId: string | undefined;

  function pluginPackageUniqueName(): string {
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8"));
      return `${settings.prefix}_${packageName}`;
    } catch {
      return `${env?.prefix}_${packageName}`;
    }
  }

  /** Multi-select quick pick: toggle the first item, then confirm. Diagnostic-
   * chatty so a failing run reveals whether the widget or the items were the
   * problem. */
  async function pickFirstAndConfirm(timeoutMs = 60000): Promise<void> {
    const log = (m: string) => console.log(`    [e2e] pick: ${m}`);
    const deadline = Date.now() + timeoutMs;
    let input: InputBox | undefined;
    while (!input && Date.now() < deadline) {
      input = await InputBox.create(3000).catch(() => undefined);
      if (!input) {
        await sleep(1500);
      }
    }
    if (!input) {
      throw new Error("No quick pick appeared for the profile download.");
    }
    log("input box appeared");
    for (;;) {
      const picks = await input.getQuickPicks().catch(() => []);
      if (picks.length > 0) {
        log(`${picks.length} item(s) — selecting the first`);
        await picks[0].select();
        break;
      }
      if (Date.now() > deadline) {
        throw new Error("Profile quick pick never populated.");
      }
      await sleep(1500);
    }
    await input.confirm().catch(() => undefined);
    await sleep(2000);
  }

  before(async function () {
    if (!env) {
      this.skip();
    }
    const client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;
    workspace = freshWorkspace("plugin-profiler");
    await VSBrowser.instance.openResources(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    try {
      await runCommand("Dataverse PowerTools: Show Log");
    } catch {
      /* pre-activation */
    }
  });

  it("creates a Plugins project WITH unit testing and a step-registered class", async () => {
    const log = (m: string) => console.log(`    [e2e] ${m}`);
    await resetAllCredentials(log);
    await runCommand("Dataverse PowerTools: Initialise Project");
    await pickByLabel("Plugins");
    await pickByLabel("Service principal (client secret)");
    await answerText(env!.tenantId);
    await answerText(env!.clientId);
    await answerText(env!.clientSecret);
    await answerFlexible(env!.url);
    await pickByLabel(solutionFriendlyName);
    await answerText(projectName);
    await answerText(packageName);
    await answerText("1.0.0");
    log("setup-unit-testing: YES (the replay runs as a unit test)");
    await pickByLabel("Yes", 600000);
    await pickByLabel("xUnit", 60000);
    log("create-plugin-class prompt");
    const classFile = path.join(workspace, projectName, `${className}.cs`);
    try {
      await pickByLabel("Yes", 600000);
      await answerText(className);
    } catch {
      // The offer is focus-sensitive-adjacent (the unit-testing toasts stole it
      // once) — creating the class via the command is the same code path.
      log("create-class offer missed — invoking Create Plugin Class directly");
      await dismissOverlays();
      await runCommand("Dataverse PowerTools: Create Plugin Class");
      await answerText(className);
    }
    await sleep(4000);
    await dismissOverlays();
    if (!(await waitForFile(classFile, 60000))) {
      log("class file absent — invoking Create Plugin Class directly");
      await runCommand("Dataverse PowerTools: Create Plugin Class");
      await answerText(className);
    }
    expect(await waitForFile(classFile, 300000), `${className}.cs`).to.equal(true);
    // Register a REAL step on a rarely-touched entity: Update of territory,
    // post-op sync — Build Package & Deploy registers it from the attribute.
    const source = fs.readFileSync(classFile, "utf8");
    const decorated = source.replace(
      new RegExp(`(public class ${className})`),
      `[CrmPluginRegistration(MessageNameEnum.Create, "territory", StageEnum.PostOperation, ExecutionModeEnum.Synchronous, "", "E2E profiler step", 1, IsolationModeEnum.Sandbox)]\n    $1`,
    );
    expect(decorated, "attribute inserted").to.not.equal(source);
    fs.writeFileSync(classFile, decorated);
  });

  it("deploys the package (step registered from the attribute)", async () => {
    await runCommand("Dataverse PowerTools: Build Package & Deploy");
    const client = new E2EClient(env!);
    await client.connect();
    let id: string | undefined;
    const deadline = Date.now() + 300000;
    do {
      id = await client.findPluginPackageId(pluginPackageUniqueName()).catch(() => undefined);
      if (id) {
        break;
      }
      await sleep(7000);
    } while (Date.now() < deadline);
    expect(id, "plugin package deployed").to.not.equal(undefined);
    await sleep(10000); // step registration follows the upsert
  });

  it("profiles the step, triggers it, and the capture lands", async () => {
    await dismissOverlays();
    await runCommandResilient("Dataverse PowerTools: Profile a Plugin Step");
    await pickFirstAndConfirm(120000); // the single candidate step
    expect(await waitForFile(path.join(workspace, ".dvpt-profiler-backup.json"), 60000), "backup written BEFORE the rewire").to.equal(true);

    // Trigger: create a throwaway territory row via the Web API (fires the
    // Create-of-territory step). Recorded for cleanup.
    const client = new E2EClient(env!);
    await client.connect();
    triggeredTerritoryId = await client.createTerritory();
    expect(triggeredTerritoryId, "territory create accepted").to.be.a("string");

    // The profiler persists the capture as an mbs_pluginprofile row.
    const deadline = Date.now() + 180000;
    let captured = false;
    while (!captured && Date.now() < deadline) {
      captured = await client.hasPluginProfileForType(`${projectName}.${className}`);
      if (!captured) {
        await sleep(6000);
      }
    }
    expect(captured, "capture persisted to the Plug-in Profile table").to.equal(true);
  });

  it("downloads the capture and stops profiling (byte-restore)", async () => {
    await dismissOverlays();
    await runCommandResilient("Dataverse PowerTools: Download Captured Plugin Profiles");
    await pickFirstAndConfirm(120000);
    const profilesDir = path.join(workspace, "profiles");
    const deadline = Date.now() + 60000;
    let files: string[] = [];
    while (files.length === 0 && Date.now() < deadline) {
      files = fs.existsSync(profilesDir) ? fs.readdirSync(profilesDir).filter((f) => f.includes(".profile")) : [];
      if (files.length === 0) {
        await sleep(3000);
      }
    }
    expect(files.length, "profile downloaded into profiles/").to.be.greaterThan(0);

    await runCommandResilient("Dataverse PowerTools: Stop Profiling a Plugin Step");
    await sleep(8000); // single backup → restores without a pick
    expect(fs.existsSync(path.join(workspace, ".dvpt-profiler-backup.json")), "backup consumed after verified restore").to.equal(false);
  });

  it("generates the replay test and dotnet test runs it GREEN", async () => {
    await dismissOverlays();
    await runCommandResilient("Dataverse PowerTools: Replay Plugin Profile as Unit Test");
    await sleep(15000); // single profile → no pick; fetches PRT assemblies (cached after first run)
    const testDir = path.join(workspace, `${projectName}.Tests`);
    const replayFile = fs.existsSync(testDir) ? fs.readdirSync(testDir).find((f) => f.startsWith("Replay_")) : undefined;
    expect(replayFile, "Replay_*.cs generated in the test project").to.not.equal(undefined);
    expect(fs.readFileSync(path.join(workspace, `${projectName}.Tests`, `${projectName}.Tests.csproj`), "utf8")).to.contain("PluginProfiler.Library");

    const run = cp.spawnSync("dotnet", ["test", testDir, "--filter", `FullyQualifiedName~${replayFile!.replace(/\.cs$/, "")}`], {
      encoding: "utf8",
      timeout: 600000,
      cwd: workspace,
    });
    console.log(`    [e2e] dotnet test tail: ${(run.stdout ?? "").slice(-600)}`);
    expect(run.status, `replay test exit code — the plugin's Execute replayed in-process\n${(run.stdout ?? "").slice(-1500)}\n${(run.stderr ?? "").slice(-500)}`).to.equal(0);
  });

  after(async function () {
    if (!env) {
      return;
    }
    // Restore any step left profiled, then remove the deployed package.
    try {
      await runCommandResilient("Dataverse PowerTools: Repair Profiled Steps");
      await sleep(8000);
    } catch {
      /* fine — nothing to repair */
    }
    const client = new E2EClient(env);
    await client.connect();
    if (triggeredTerritoryId) {
      await client.deleteTerritory(triggeredTerritoryId);
    }
    await client.deletePluginPackage(pluginPackageUniqueName());
  });
});
