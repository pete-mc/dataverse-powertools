import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import { runScopedName, loadE2EEnv, freshWorkspace, answerText, answerFlexible, pickByLabel, runCommand, waitForFile, dismissOverlays, sleep, E2EClient } from "./lib";
import { resetAllCredentials } from "./lib";

// End-to-end: create a Plugins project via the real wizard using INTERACTIVE (OAuth) sign-in —
// then Build Package & Deploy it to the live environment and verify it landed. The interactive
// connect is silent because DVPT_TEST_MSAL_CACHE_FILE points at a cache pre-seeded by
// preAcquireInteractiveCache.mjs (so there is no browser to drive inside ExTester). Proves the
// interactive-auth wizard path end-to-end for plugins (which deploy via the Dataverse Web API +
// token, not pac). Self-skips without sandbox/.env or a seeded cache.
describe("Plugin lifecycle — interactive auth (e2e)", function () {
  this.timeout(1200000);
  const env = loadE2EEnv();
  const hasCache = !!process.env.DVPT_TEST_MSAL_CACHE_FILE && fs.existsSync(process.env.DVPT_TEST_MSAL_CACHE_FILE || "");
  const projectName = "E2EPluginInt";
  const packageName = runScopedName("E2EPluginIntPkg");
  let workspace: string;
  let solutionFriendlyName: string;

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
        fs.writeFileSync(path.join(dir, `e2e-plugin-int-fail-${name}.png`), img, "base64");
      } catch {
        /* ignore */
      }
    }
  });

  before(async function () {
    if (!env || !hasCache) {
      this.skip();
    }
    const client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;

    workspace = freshWorkspace("plugin-interactive");
    await VSBrowser.instance.openResources(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    try {
      await runCommand("Dataverse PowerTools: Show Log");
    } catch {
      /* the command may not be registered until the extension activates */
    }
  });

  it("creates a Plugins project via the wizard using interactive sign-in", async () => {
    const log = (m: string) => console.log(`    [e2e] ${m}`);
    log("running Initialise Project");
    // Fresh-credential isolation: each suite proves its own auth path from zero.
    await resetAllCredentials(log);
    await runCommand("Dataverse PowerTools: Initialise Project");
    log("project type");
    await pickByLabel("Plugins");
    log("auth type: OAuth");
    await pickByLabel("OAuth");
    // Interactive signs in silently from the pre-seeded cache, then lists environments via Global
    // Discovery — no tenant/clientId/clientSecret prompts. Pick the environment by its URL.
    log("environment (silent sign-in + discovery)");
    await answerFlexible(env!.url, 120000);
    log(`solution (${solutionFriendlyName})`);
    await pickByLabel(solutionFriendlyName);
    log("plugin project name");
    await answerText(projectName);
    log("plugin package name");
    await answerText(packageName);
    log("plugin package version");
    await answerText("1.0.0");
    log("waiting for restores + setup-unit-testing prompt");
    await pickByLabel("No", 600000);
    // New projects scaffold without pac's sample class — accept the wizard's
    // create-a-class offer (Build Package & Deploy refuses an empty assembly).
    log("create-plugin-class prompt");
    await pickByLabel("Yes", 300000);
    log("plugin class name");
    await answerText("E2EIntPluginClass");
    await sleep(4000);
    await dismissOverlays();

    expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 60000), "dataverse-powertools.json").to.equal(true);
    expect(await waitForFile(path.join(workspace, projectName, `${projectName}.csproj`), 300000), `${projectName}/${projectName}.csproj`).to.equal(true);
    expect(await waitForFile(path.join(workspace, projectName, "E2EIntPluginClass.cs"), 120000), `${projectName}/E2EIntPluginClass.cs`).to.equal(true);
  });

  it("builds and deploys the plugin package to Dataverse (interactive token)", async () => {
    await runCommand("Dataverse PowerTools: Build Package & Deploy");

    const client = new E2EClient(env!);
    await client.connect();
    let id: string | undefined;
    const deadline = Date.now() + 240000;
    do {
      try {
        id = await client.findPluginPackageId(pluginPackageUniqueName());
      } catch {
        id = undefined;
      }
      if (id) {
        break;
      }
      await sleep(7000);
    } while (Date.now() < deadline);
    expect(id, `${pluginPackageUniqueName()} exists in Dataverse`).to.not.equal(undefined);
  });

  after(async function () {
    if (!env || !hasCache) {
      return;
    }
    const client = new E2EClient(env);
    await client.connect();
    await client.deletePluginPackage(pluginPackageUniqueName());
  });
});
