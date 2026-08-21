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
  pickFirst,
  runCommand,
  waitForFile,
  clearOutput,
  expectOutput,
  dismissOverlays,
  sleep,
  E2EClient,
} from "./lib";
import { resetAllCredentials } from "./lib";

// End-to-end: create a Web Resources project via the real wizard using INTERACTIVE (OAuth) sign-in,
// then generate typings, create a class + test, build, and deploy — the full lifecycle under
// interactive auth. This exercises the net8 bundled typings tool (which authenticates with the
// interactive-user token, fixing #91 — the old .exe couldn't authenticate without a client secret).
// Interactive connect is silent because DVPT_TEST_MSAL_CACHE_FILE points at a pre-seeded cache.
// Self-skips without sandbox/.env or a seeded cache.
describe("Web resources lifecycle — interactive auth (e2e)", function () {
  this.timeout(900000);
  const env = loadE2EEnv();
  const hasCache = !!process.env.DVPT_TEST_MSAL_CACHE_FILE && fs.existsSync(process.env.DVPT_TEST_MSAL_CACHE_FILE || "");
  const className = "E2EIntSample";
  let workspace: string;
  let solutionFriendlyName: string;

  function libraryName(): string {
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8"));
      // NOT run-scoped (#258). In bundle output mode the deployed name is `{prefix}_library.js`, and
      // BOTH halves are fixed: the prefix is inferred from the chosen solution's publisher (an invented
      // one would be rejected by Dataverse), and "library" is hardcoded by the product — in
      // src/webresources/libraryNames.ts and in templates/webresources/webpack.common.js. Scoping this
      // therefore needs a configurable bundle name in the product, not a change here.
      return `${settings.prefix}_library.js`;
    } catch {
      return `${env?.prefix}_library.js`;
    }
  }

  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      try {
        const dir = path.resolve(__dirname, "..", "..", "..", "sandbox", "screenshots-out");
        fs.mkdirSync(dir, { recursive: true });
        const img = await VSBrowser.instance.driver.takeScreenshot();
        const name = (this.currentTest?.title || "step").replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
        fs.writeFileSync(path.join(dir, `e2e-wr-int-fail-${name}.png`), img, "base64");
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

    workspace = freshWorkspace("webresource-interactive");
    await openWorkspaceFolder(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    try {
      await runCommand("Dataverse PowerTools: Show Log");
    } catch {
      /* the command may not be registered until the extension activates */
    }
  });

  it("creates a Web Resources project via the wizard using interactive sign-in", async () => {
    const log = (m: string) => console.log(`    [e2e] ${m}`);
    log("running Initialise Project");
    // Fresh-credential isolation: each suite proves its own auth path from zero.
    await resetAllCredentials(log);
    await runCommand("Dataverse PowerTools: Initialise Project");
    log("project type");
    await pickByLabel("Web Resources");
    log("auth type: OAuth");
    await pickByLabel("OAuth");
    log("environment (silent sign-in + discovery)");
    await answerFlexible(env!.url, 120000);
    log(`solution (${solutionFriendlyName})`);
    await pickByLabel(solutionFriendlyName);
    log("output mode prompt");
    await pickByLabel("Single bundled library (recommended)", 600000); // output mode (#88) — restores run first
    log("waiting for restores + create-webresource prompt");
    await pickByLabel("No", 600000);
    await sleep(4000);
    await dismissOverlays();

    expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 60000), "dataverse-powertools.json").to.equal(true);
  });

  it("generates typings under interactive auth (bundled net8 tool, #91)", async () => {
    await runCommand("Dataverse PowerTools: Generate Typings");
    expect(await waitForFile(path.join(workspace, "typings", "XRM"), 180000), "typings/XRM generated under interactive auth").to.equal(true);
  });

  it("creates a web resource class and test", async () => {
    await runCommand("Dataverse PowerTools: Create Web Resource Class");
    await answerText(className);
    await pickFirst(60000);
    await pickFirst(60000);
    await pickByLabel("Yes", 60000);
    await sleep(3000);
    await dismissOverlays();
    expect(await waitForFile(path.join(workspace, "webresources_src", `${className}.ts`), 30000), `${className}.ts`).to.equal(true);
  });

  it("builds and deploys the webresource to Dataverse (interactive token)", async () => {
    await runCommand("Dataverse PowerTools: Build and Deploy Webresources");
    await sleep(25000);
    await dismissOverlays();

    const client = new E2EClient(env!);
    await client.connect();
    let id: string | undefined;
    const deadline = Date.now() + 90000;
    do {
      try {
        id = await client.findWebresourceId(libraryName());
      } catch {
        id = undefined;
      }
      if (id) {
        break;
      }
      await sleep(5000);
    } while (Date.now() < deadline);
    expect(id, `${libraryName()} exists in Dataverse`).to.not.equal(undefined);
  });

  it("registers the form events under interactive auth (gated on the log)", async () => {
    await clearOutput();
    await runCommand("Dataverse PowerTools: Register Form Events");
    // The exact path that failed for interactive users: form register + publish gated on a tenantId
    // that OAuth sign-in never sets, reporting "Could not connect to dataverse." (then silently
    // no-op'ing the publish). Gate on "Publish Complete" and fail fast on the old symptom.
    await expectOutput("Publish Complete", {
      timeoutMs: 300000, // publish retries when another publish is still running
      failMarkers: ["Could not connect to dataverse.", "Error registering events.", "Failed to save form", "Failed to publish customizations"],
      step: "register form events (interactive)",
    });
    await sleep(10000);
  });

  after(async function () {
    if (!env || !hasCache) {
      return;
    }
    const client = new E2EClient(env);
    await client.connect();
    await client.deleteWebresource(libraryName());
  });
});
