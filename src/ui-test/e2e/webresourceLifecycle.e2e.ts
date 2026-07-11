import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import { loadE2EEnv, freshWorkspace, answerText, answerFlexible, pickByLabel, pickFirst, runCommand, waitForFile, dismissOverlays, sleep, E2EClient } from "./lib";

// End-to-end: create a Web Resources project from scratch via the real wizard, then
// generate typings, create a class + test, build the TypeScript, and deploy to the
// live test environment — the whole lifecycle that unit tests can't reach. Uses fixed
// names and cleans up the deployed webresource. Self-skips without sandbox/.env.
describe("Web resources lifecycle (e2e)", function () {
  this.timeout(900000);
  const env = loadE2EEnv();
  const className = "E2ESample";
  let workspace: string;
  let solutionFriendlyName: string; // the wizard lists solutions by friendly name, not unique name

  // The solution's publisher prefix is inferred by the wizard, so the built library is
  // `<prefix>_library.js`. Read it from the created settings rather than assuming it.
  function libraryName(): string {
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8"));
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
        fs.writeFileSync(path.join(dir, `e2e-fail-${name}.png`), img, "base64");
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

    workspace = freshWorkspace("webresource");
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

  it("creates a Web Resources project via the Initialise Project wizard", async () => {
    const log = (m: string) => console.log(`    [e2e] ${m}`);
    log("running Initialise Project");
    await runCommand("Dataverse PowerTools: Initialise Project");
    log("project type");
    await pickByLabel("Web Resources");
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
    log("output mode prompt");
    await pickByLabel("Single bundled library (recommended)", 600000); // output mode (#88) — restores run first
    log("waiting for restores + create-webresource prompt");
    await pickByLabel("No", 600000); // "create a new webresource?" — restores + typings run first
    await sleep(4000);
    await dismissOverlays();

    // Project scaffolding + restore must have produced the settings file (catches the ERESOLVE
    // restore bug). Poll — the npm restore takes a while. Typings no longer restore a Windows-only
    // nuget .exe (#78 — the net8 tool ships with the extension), so there's nothing else to await.
    expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 300000), "dataverse-powertools.json").to.equal(true);
  });

  it("generates typings", async () => {
    await runCommand("Dataverse PowerTools: Generate Typings");
    expect(await waitForFile(path.join(workspace, "typings", "XRM"), 180000), "typings/XRM generated").to.equal(true);
  });

  it("creates a web resource class and test", async () => {
    await runCommand("Dataverse PowerTools: Create Web Resource Class");
    await answerText(className); // 1: class name
    await pickFirst(60000); // 2: table (first available)
    await pickFirst(60000); // 3: form (first available)
    await pickByLabel("Yes", 60000); // 4: create test?
    await sleep(3000);
    await dismissOverlays();

    expect(await waitForFile(path.join(workspace, "webresources_src", `${className}.ts`), 30000), `${className}.ts`).to.equal(true);
    expect(await waitForFile(path.join(workspace, "webresources_src", "__tests__", `${className}.test.ts`), 30000), `${className}.test.ts`).to.equal(true);
  });

  it("builds the TypeScript with webpack", async () => {
    await runCommand("Dataverse PowerTools: Build Webresources");
    expect(await waitForFile(path.join(workspace, "bin", libraryName()), 180000), `bin/${libraryName()}`).to.equal(true);
  });

  it("deploys the webresource to Dataverse", async () => {
    await runCommand("Dataverse PowerTools: Build and Deploy Webresources");
    await sleep(25000); // build + upsert + publish
    await dismissOverlays();

    // Deploy is build + upsert + publish; poll rather than assume it's done after one
    // fixed wait, so a slow publish or a transient network blip doesn't fail the run.
    const client = new E2EClient(env!);
    await client.connect();
    let id: string | undefined;
    const deadline = Date.now() + 90000;
    do {
      try {
        id = await client.findWebresourceId(libraryName());
      } catch {
        id = undefined; // transient network error — keep polling
      }
      if (id) {
        break;
      }
      await sleep(5000);
    } while (Date.now() < deadline);
    expect(id, `${libraryName()} exists in Dataverse`).to.not.equal(undefined);
  });

  after(async function () {
    if (!env) {
      return;
    }
    const client = new E2EClient(env);
    await client.connect();
    await client.deleteWebresource(libraryName());
  });
});
