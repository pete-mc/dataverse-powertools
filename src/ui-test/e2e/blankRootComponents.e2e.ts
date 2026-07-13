import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import { loadE2EEnv, freshWorkspace, answerText, answerFlexible, pickByLabel, runCommand, waitForFile, dismissOverlays, sleep, E2EClient } from "./lib";
import { resetAllCredentials } from "./lib";

// End-to-end for the BLANK (connection-only) root + Add Component (user request):
// initialise an "Empty (components in subfolders)" workspace, then add one
// component of EVERY other type into subfolders. Each component's settings file
// must carry its type but NO connection (it inherits the root's); the root file
// must stay typeless with the connection. Scaffold + restore per type is proven
// by a marker file (plugin's is the pac-init csproj, so its restore path runs).
describe("Blank root + one component of each type (e2e)", function () {
  this.timeout(1500000);
  const env = loadE2EEnv();
  let workspace: string;
  let solutionFriendlyName: string;

  function readSettings(relative: string): any {
    return JSON.parse(fs.readFileSync(path.join(workspace, relative, "dataverse-powertools.json"), "utf8"));
  }

  /** Poll for any file matching a predicate under a folder (recursive). */
  async function waitForMatch(root: string, matches: (file: string) => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const scan = (dir: string): boolean => {
      if (!fs.existsSync(dir)) {
        return false;
      }
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules") {
          if (scan(full)) {
            return true;
          }
        } else if (matches(entry.name)) {
          return true;
        }
      }
      return false;
    };
    for (;;) {
      if (scan(root)) {
        return true;
      }
      if (Date.now() > deadline) {
        return false;
      }
      await sleep(3000);
    }
  }

  /** Open Add Component and land on the type pick — retries once, because the
   * PREVIOUS component's restore progress/toast can swallow the first attempt
   * (the Solution/Portal adds timed out exactly there on the first gate run). */
  async function startAddComponent(typeLabel: string): Promise<void> {
    await sleep(8000); // let the previous add's notifications settle
    await dismissOverlays();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await runCommand("Dataverse PowerTools: Add Component");
        await pickByLabel(typeLabel, 30000);
        return;
      } catch (err) {
        if (attempt === 1) {
          throw err;
        }
        await dismissOverlays();
        await sleep(5000);
      }
    }
  }

  before(async function () {
    if (!env) {
      this.skip();
    }
    const client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;

    workspace = freshWorkspace("blank-root");
    await VSBrowser.instance.openResources(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    try {
      await runCommand("Dataverse PowerTools: Show Log");
    } catch {
      /* not registered until activation */
    }
  });

  it("initialises a connection-only (blank) root via the wizard", async () => {
    const log = (m: string) => console.log(`    [e2e] ${m}`);
    log("running Initialise Project");
    await resetAllCredentials(log);
    await runCommand("Dataverse PowerTools: Initialise Project");
    log("project type: Empty");
    await pickByLabel("Empty (components in subfolders)");
    log("auth type");
    await pickByLabel("Service principal (client secret)");
    await answerText(env!.tenantId);
    await answerText(env!.clientId);
    await answerText(env!.clientSecret);
    log("environment");
    await answerFlexible(env!.url);
    log(`solution (${solutionFriendlyName})`);
    await pickByLabel(solutionFriendlyName);
    await sleep(5000);
    await dismissOverlays();

    expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 120000), "root dataverse-powertools.json").to.equal(true);
    const settings = readSettings(".");
    expect(settings.type, "blank root has NO project type").to.equal(undefined);
    expect(settings.connectionString, "blank root carries the connection").to.be.a("string").and.not.equal("");
  });

  it("adds a Web Resources component into a subfolder", async () => {
    await startAddComponent("Web Resources");
    await answerText("webresources"); // subfolder (the suggested default)
    // Scaffold + npm install run behind a progress notification — poll the outputs.
    expect(await waitForFile(path.join(workspace, "webresources", "dataverse-powertools.json"), 600000), "webresources settings").to.equal(true);
    expect(await waitForFile(path.join(workspace, "webresources", "webpack.common.js"), 60000), "webresources scaffold").to.equal(true);
    // Gate on npm install COMPLETING so the next add starts with a quiet UI.
    expect(await waitForFile(path.join(workspace, "webresources", "node_modules", ".package-lock.json"), 600000), "npm install finished").to.equal(true);
    const settings = readSettings("webresources");
    expect(settings.type).to.equal("webresources");
    expect(settings.connectionString, "component inherits the root connection — no own connectionString").to.equal(undefined);
    // Template substitution must run at Add-Component time (the component carries the
    // inherited prefix): webpack.common.js has the real prefix, not the literal token.
    const webpackCommon = fs.readFileSync(path.join(workspace, "webresources", "webpack.common.js"), "utf8");
    expect(webpackCommon, "SOLUTIONPREFIX token substituted").to.not.contain("SOLUTIONPREFIX");
    expect(settings.prefix, "component carries the inherited publisher prefix").to.be.a("string").and.not.equal("");
    expect(webpackCommon, "webpack.common.js uses the real prefix").to.contain(`${settings.prefix}_library.js`);
  });

  it("adds a Plugins component into a subfolder (pac init + restore)", async () => {
    await startAddComponent("Plugins");
    await answerText("plugin"); // subfolder
    await answerText("E2EBlankPlugin"); // plugin project name
    expect(await waitForFile(path.join(workspace, "plugin", "dataverse-powertools.json"), 600000), "plugin settings").to.equal(true);
    expect(await waitForMatch(path.join(workspace, "plugin"), (file) => file.endsWith(".csproj"), 600000), "a csproj scaffolded by pac plugin init").to.equal(true);
    // Layout normalisation must have produced the .sln (MSB1003 regression — the
    // final dotnet restore needs it) and the restore must have COMPLETED
    // (project.assets.json) before the next add begins.
    expect(await waitForMatch(path.join(workspace, "plugin"), (file) => file.endsWith(".sln"), 300000), "normalised layout (.sln)").to.equal(true);
    expect(await waitForMatch(path.join(workspace, "plugin"), (file) => file === "project.assets.json", 600000), "dotnet restore finished").to.equal(true);
    const settings = readSettings("plugin");
    expect(settings.type).to.equal("plugin");
    expect(settings.pluginProjectName).to.equal("E2EBlankPlugin");
    expect(settings.connectionString).to.equal(undefined);
  });

  it("adds a Solution component into a subfolder", async () => {
    await startAddComponent("Solution");
    await answerText("solution"); // subfolder
    expect(await waitForFile(path.join(workspace, "solution", "dataverse-powertools.json"), 600000), "solution settings").to.equal(true);
    expect(await waitForFile(path.join(workspace, "solution", "nuget.config"), 120000), "solution scaffold").to.equal(true);
    // The solution restore chain ends with paket install — gate on its lock file.
    expect(await waitForFile(path.join(workspace, "solution", "paket.lock"), 600000), "paket install finished").to.equal(true);
    const settings = readSettings("solution");
    expect(settings.type).to.equal("solution");
    expect(settings.templateversion, "integer template version (1.1 float retired, #71)").to.equal(2);
    expect(settings.connectionString).to.equal(undefined);
  });

  it("adds a Portal component into a subfolder", async () => {
    await startAddComponent("Portal");
    await answerText("portal"); // subfolder
    expect(await waitForFile(path.join(workspace, "portal", "dataverse-powertools.json"), 300000), "portal settings").to.equal(true);
    const settings = readSettings("portal");
    expect(settings.type).to.equal("portal");
    expect(settings.connectionString).to.equal(undefined);
  });

  it("root stays a typeless connection-only file after all additions", async () => {
    const settings = readSettings(".");
    expect(settings.type).to.equal(undefined);
    expect(settings.connectionString).to.be.a("string").and.not.equal("");
  });
});
