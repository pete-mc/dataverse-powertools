import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import { loadE2EEnv, freshWorkspace, answerText, answerFlexible, pickByLabel, runCommand, waitForFile, dismissOverlays, sleep, E2EClient } from "./lib";

// End-to-end: create a Plugins project from scratch via the real wizard (pac plugin init
// under the hood), then Build Package & Deploy it to the live test environment and verify
// the plugin package landed in Dataverse — the whole lifecycle unit tests can't reach.
// Uses fixed names and cleans up the deployed package. Self-skips without sandbox/.env.
describe("Plugin lifecycle (e2e)", function () {
  this.timeout(1200000);
  const env = loadE2EEnv();
  const projectName = "E2EPlugin"; // becomes <projectName>.csproj after normalizePluginV3Layout
  const packageName = "E2EPluginPkg";
  let workspace: string;
  let solutionFriendlyName: string; // the wizard lists solutions by friendly name, not unique name

  // The Dataverse plugin package unique name is <publisherPrefix>_<packageName> (see
  // buildPluginPackageUniqueName in buildAndDeploy.ts). The prefix is inferred by the
  // wizard from the chosen solution, so read it from the created settings.
  function pluginPackageUniqueName(): string {
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8"));
      return `${settings.prefix}_${packageName}`;
    } catch {
      return `${env?.prefix}_${packageName}`;
    }
  }

  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      try {
        const dir = path.resolve(__dirname, "..", "..", "..", "sandbox", "screenshots-out");
        fs.mkdirSync(dir, { recursive: true });
        const img = await VSBrowser.instance.driver.takeScreenshot();
        const name = (this.currentTest?.title || "step").replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
        fs.writeFileSync(path.join(dir, `e2e-plugin-fail-${name}.png`), img, "base64");
      } catch {
        /* ignore */
      }
    }
  });

  before(async function () {
    if (!env) {
      this.skip();
    }
    // Resolve the solution's friendly name (the wizard lists solutions by friendly
    // name; DVPT_TEST_SOLUTION_NAME is the unique name).
    const client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;

    workspace = freshWorkspace("plugin");
    await VSBrowser.instance.openResources(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    // Keep the Dataverse PowerTools output channel visible so progress/errors are
    // watchable live during the run.
    try {
      await runCommand("Dataverse PowerTools: Show Log");
    } catch {
      /* the command may not be registered until the extension activates */
    }
  });

  it("creates a Plugins project via the Initialise Project wizard", async () => {
    const log = (m: string) => console.log(`    [e2e] ${m}`);
    log("running Initialise Project");
    await runCommand("Dataverse PowerTools: Initialise Project");
    log("project type");
    await pickByLabel("Plugins");
    log("auth type");
    await pickByLabel("Service principal (client secret)");
    log("tenant");
    await answerText(env!.tenantId);
    log("clientId");
    await answerText(env!.clientId);
    log("clientSecret");
    await answerText(env!.clientSecret);
    log("environment (quick pick or manual url)");
    await answerFlexible(env!.url);
    log(`solution (${solutionFriendlyName})`);
    await pickByLabel(solutionFriendlyName);
    log("plugin project name");
    await answerText(projectName);
    log("plugin package name");
    await answerText(packageName);
    log("plugin package version");
    await answerText("1.0.0");
    log("waiting for restores + setup-unit-testing prompt");
    await pickByLabel("No", 600000); // "set up unit testing?" — pac plugin init + restore run first
    await sleep(4000);
    await dismissOverlays();

    // Project scaffolding + pac plugin init must have produced these. normalizePluginV3Layout
    // renames Plugin.csproj -> <projectName>.csproj inside the <projectName> folder.
    expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 60000), "dataverse-powertools.json").to.equal(true);
    expect(await waitForFile(path.join(workspace, projectName, `${projectName}.csproj`), 300000), `${projectName}/${projectName}.csproj`).to.equal(true);
  });

  it("builds and deploys the plugin package to Dataverse", async () => {
    await runCommand("Dataverse PowerTools: Build Package & Deploy");

    // dotnet build (net462) + pack + upsert + publish can take minutes — poll for the
    // package rather than assume a fixed wait, and tolerate a transient network blip.
    const client = new E2EClient(env!);
    await client.connect();
    let id: string | undefined;
    const deadline = Date.now() + 240000;
    do {
      try {
        id = await client.findPluginPackageId(pluginPackageUniqueName());
      } catch {
        id = undefined; // transient network error — keep polling
      }
      if (id) {
        break;
      }
      await sleep(7000);
    } while (Date.now() < deadline);
    expect(id, `${pluginPackageUniqueName()} exists in Dataverse`).to.not.equal(undefined);
  });

  after(async function () {
    if (!env) {
      return;
    }
    const client = new E2EClient(env);
    await client.connect();
    await client.deletePluginPackage(pluginPackageUniqueName());
  });
});
