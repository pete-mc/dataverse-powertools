import * as path from "path";
import * as fs from "fs";
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
  runCommandResilient,
  waitForFile,
  clearOutput,
  expectOutput,
  dismissOverlays,
  sleep,
  E2EClient,
} from "./lib";
import { resetAllCredentials } from "./lib";

// #113 e2e: a project with STALE / broken extension-owned config files is repaired
// by "Refresh Project Config Files" — originals are backed up, the current
// templates re-render, and the project builds again. Scaffolds a web-resources
// project, corrupts webpack.common.js + drops the configRevision stamp, then
// refreshes and rebuilds. Self-skips without sandbox/.env.
describe("Config refresh (#113) — repairs stale config and rebuilds (e2e)", function () {
  this.timeout(900000);
  const env = loadE2EEnv();
  let workspace: string;
  let solutionFriendlyName: string;

  const settingsPath = () => path.join(workspace, "dataverse-powertools.json");
  const webpackPath = () => path.join(workspace, "webpack.common.js");
  function libraryName(): string {
    try {
      return `${JSON.parse(fs.readFileSync(settingsPath(), "utf8")).prefix}_library.js`;
    } catch {
      return `${env?.prefix}_library.js`;
    }
  }

  before(async function () {
    if (!env) {
      this.skip();
    }
    const client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;

    workspace = freshWorkspace("config-refresh");
    await openWorkspaceFolder(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    try {
      await runCommand("Dataverse PowerTools: Show Log");
    } catch {
      /* pre-activation */
    }
  });

  it("scaffolds a web-resources project", async () => {
    const log = (m: string) => console.log(`    [e2e] ${m}`);
    await resetAllCredentials(log);
    await runCommand("Dataverse PowerTools: Initialise Project");
    await pickByLabel("Web Resources");
    await pickByLabel("Service principal (client secret)");
    await answerText(env!.tenantId);
    await answerText(env!.clientId);
    await answerText(env!.clientSecret);
    await answerFlexible(env!.url);
    await pickByLabel(solutionFriendlyName);
    await pickByLabel("Single bundled library (recommended)", 600000);
    await pickByLabel("No", 600000); // create a webresource? — restores run first
    await sleep(4000);
    await dismissOverlays();
    expect(await waitForFile(settingsPath(), 300000), "dataverse-powertools.json").to.equal(true);
    expect(await waitForFile(path.join(workspace, "node_modules", ".package-lock.json"), 600000), "npm install finished").to.equal(true);
  });

  it("regresses the config: corrupt webpack.common.js + drop the config revision", async () => {
    // A fresh scaffold stamps the current configRevision; force the STALE state
    // and break the build so the refresh has something real to repair.
    const settings = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    delete settings.configRevision; // predates the stamp — reads as stale
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    fs.writeFileSync(webpackPath(), "// CORRUPTED BY THE E2E — not valid webpack config\nthrow new Error('stale config');\n");
    expect(fs.readFileSync(webpackPath(), "utf8")).to.contain("CORRUPTED");
  });

  it("Refresh Project Config Files repairs the config and backs up the original", async () => {
    await clearOutput();
    await runCommandResilient("Dataverse PowerTools: Refresh Project Config Files");
    // The refresh logs the backup location + revision bump.
    await expectOutput("[Upgrade] Refreshed", { timeoutMs: 60000, failMarkers: ["no refreshable config files"], step: "refresh config files" });
    await sleep(2000);

    // Original corrupted file is backed up.
    const backupRoot = path.join(workspace, ".dvpt-upgrade-backup");
    expect(fs.existsSync(backupRoot), ".dvpt-upgrade-backup created").to.equal(true);
    const stamps = fs.readdirSync(backupRoot);
    expect(stamps.length, "a timestamped backup folder").to.be.greaterThan(0);
    expect(fs.readFileSync(path.join(backupRoot, stamps[0], "webpack.common.js"), "utf8"), "backup holds the corrupted original").to.contain("CORRUPTED");

    // webpack.common.js re-rendered from the current template (output-mode aware).
    const repaired = fs.readFileSync(webpackPath(), "utf8");
    expect(repaired, "repaired from template").to.not.contain("CORRUPTED");
    expect(repaired, "current template shape").to.contain("webresourceOutput");

    // Revision stamped forward — no longer stale.
    expect(JSON.parse(fs.readFileSync(settingsPath(), "utf8")).configRevision, "configRevision stamped").to.be.a("number");
  });

  it("the repaired project builds again", async () => {
    await clearOutput();
    await runCommandResilient("Dataverse PowerTools: Build Webresources");
    await expectOutput("Building Complete", { timeoutMs: 180000, step: "build after refresh" });
    expect(await waitForFile(path.join(workspace, "bin", libraryName()), 30000), `bin/${libraryName()}`).to.equal(true);
  });
});
