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
  runScopedIdentifier,
} from "./lib";
import { resetAllCredentials, assertSourceMapBindsBreakpoints } from "./lib";

// End-to-end for PER-FILE output mode (#88, user request): every step the bundled
// lifecycle covers, PLUS the two things only per-file mode can get wrong —
// 1) the deployed JS must expose PREFIX.Class.Function (the shape form handlers
//    call): the built bundle is EXECUTED in-process and the global asserted;
// 2) the registered form handler must bind to the per-file library
//    <prefix>_<Class>.js with functionName PREFIX.Class.OnLoad (asserted from
//    the live form XML), not the bundled <prefix>_library.js.
// The touched form's XML is captured before registration and restored after.
describe("Web resources lifecycle — per-file output (e2e)", function () {
  this.timeout(900000);
  const env = loadE2EEnv();
  // Scoped per run (#258): in per-file output mode the deployed web resource is
  // `{prefix}_{className}.js`, so the class name is what keeps two overlapping runs from
  // deploying over each other's row — and from each cleaning up the other's.
  const className = runScopedIdentifier("E2EPerFile");
  let workspace: string;
  let solutionFriendlyName: string;
  let formId = "";
  let formXmlBefore: string | undefined;

  function prefix(): string {
    try {
      return JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8")).prefix;
    } catch {
      return env?.prefix ?? "";
    }
  }
  const perFileLibrary = () => `${prefix()}_${className}.js`;

  before(async function () {
    if (!env) {
      this.skip();
    }
    const client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;

    workspace = freshWorkspace("webresource-perfile");
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

  it("creates a Web Resources project in per-file mode via the wizard", async () => {
    const log = (m: string) => console.log(`    [e2e] ${m}`);
    log("running Initialise Project");
    await resetAllCredentials(log);
    await runCommand("Dataverse PowerTools: Initialise Project");
    log("project type");
    await pickByLabel("Web Resources");
    log("auth type");
    await pickByLabel("Service principal (client secret)");
    await answerText(env!.tenantId);
    await answerText(env!.clientId);
    await answerText(env!.clientSecret);
    log("environment");
    await answerFlexible(env!.url);
    log(`solution (${solutionFriendlyName})`);
    await pickByLabel(solutionFriendlyName);
    log("output mode: PER FILE");
    await pickByLabel("One file per web resource", 600000);
    log("waiting for restores + create-webresource prompt");
    await pickByLabel("No", 600000);
    await sleep(4000);
    await dismissOverlays();

    expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 300000), "dataverse-powertools.json").to.equal(true);
    expect(JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8")).webresourceOutput, "webresourceOutput").to.equal("perFile");
  });

  it("generates typings and creates a class with a form registration", async () => {
    await runCommand("Dataverse PowerTools: Generate Typings");
    expect(await waitForFile(path.join(workspace, "typings", "XRM"), 180000), "typings/XRM").to.equal(true);

    await runCommand("Dataverse PowerTools: Create Web Resource Class");
    await answerText(className);
    await pickFirst(60000); // table
    await pickFirst(60000); // form
    await pickByLabel("No", 60000); // test not needed here
    await sleep(3000);
    await dismissOverlays();
    const classFile = path.join(workspace, "webresources_src", `${className}.ts`);
    expect(await waitForFile(classFile, 30000), `${className}.ts`).to.equal(true);
    const source = fs.readFileSync(classFile, "utf8");
    formId = (source.match(/formId:\s*"([0-9a-fA-F-]{36})"/)?.[1] ?? "").toLowerCase();
    expect(formId, "formId embedded in the class file").to.match(/^[0-9a-f-]{36}$/);
    // The decoration must call through the global the per-file bundle creates.
    expect(source).to.contain(`function: "${prefix()}.${className}.OnLoad"`);
  });

  it("builds ONE file per web resource and the bundle exposes PREFIX.Class.Function", async () => {
    await runCommand("Dataverse PowerTools: Build Webresources");
    const built = path.join(workspace, "bin", perFileLibrary());
    expect(await waitForFile(built, 180000), `bin/${perFileLibrary()}`).to.equal(true);
    expect(fs.existsSync(path.join(workspace, "bin", `${prefix()}_library.js`)), "no bundled library in per-file mode").to.equal(false);

    // Execute the built bundle the way a form would load it and assert the
    // callable global — the exact shape the registered handler invokes. This is
    // what catches "the way we call the functions is wrong" without a browser.
    const code = fs.readFileSync(built, "utf8");
    const g = globalThis as any;
    g.self = g.self ?? globalThis;
    g.window = g.window ?? globalThis;
    delete g[prefix()];
    new Function(code)();
    expect(g[prefix()], `global ${prefix()} created by the bundle`).to.be.an("object");
    expect(g[prefix()][className], `${prefix()}.${className}`).to.exist;
    expect(g[prefix()][className].OnLoad, `${prefix()}.${className}.OnLoad`).to.be.a("function");
    delete g[prefix()];

    // Breakpoint-binding parity: the bundle's REAL source-map names must match
    // the attach config's overrides (the "unbound breakpoints" bug class).
    assertSourceMapBindsBreakpoints(built, workspace, prefix(), `${className}.ts`);
  });

  it("deploys the per-file webresource to Dataverse under its own name", async () => {
    await runCommand("Dataverse PowerTools: Build and Deploy Webresources");
    await sleep(25000);
    await dismissOverlays();

    const client = new E2EClient(env!);
    await client.connect();
    let id: string | undefined;
    const deadline = Date.now() + 120000;
    do {
      id = await client.findWebresourceId(perFileLibrary()).catch(() => undefined);
      if (id) {
        break;
      }
      await sleep(5000);
    } while (Date.now() < deadline);
    expect(id, `${perFileLibrary()} exists in Dataverse`).to.not.equal(undefined);
    const deployed = await client.getWebresourceContent(perFileLibrary());
    expect(deployed, "deployed content").to.contain(className);
  });

  it("registers the form handler against the PER-FILE library (asserted from the form XML)", async () => {
    const client = new E2EClient(env!);
    await client.connect();
    formXmlBefore = await client.getFormXml(formId);
    expect(formXmlBefore, "form XML captured for restore").to.be.a("string");

    // Clearing matters here: the DEPLOY step also printed "Publish Complete",
    // so a stale panel would let expectOutput false-positive. The clear button
    // can be non-interactable right after the deploy toasts (flaked once) —
    // dismiss + retry, and only then give up loudly.
    for (let attempt = 0; ; attempt++) {
      try {
        await dismissOverlays();
        await clearOutput();
        break;
      } catch (err) {
        if (attempt >= 2) {
          throw err;
        }
        await sleep(5000);
      }
    }
    await runCommand("Dataverse PowerTools: Register Form Events");
    await expectOutput("Publish Complete", {
      timeoutMs: 300000,
      failMarkers: ["Failed to save form", "Failed to publish customizations", "Error registering events."],
      step: "register form events (per-file)",
    });
    await sleep(10000);

    const formXml = (await client.getFormXml(formId)) ?? "";
    expect(formXml, "per-file <Library> on the form").to.contain(`name="${perFileLibrary()}"`);
    expect(formXml, "handler functionName is PREFIX.Class.OnLoad").to.contain(`functionName="${prefix()}.${className}.OnLoad"`);
    expect(formXml, "handler binds the per-file library, not the bundle").to.contain(`libraryName="${perFileLibrary()}"`);
    expect(formXml).to.not.contain(`libraryName="${prefix()}_library.js"`);
  });

  after(async function () {
    if (!env) {
      return;
    }
    const client = new E2EClient(env);
    await client.connect();
    // Restore the form byte-identical (other suites' live-app checks use it),
    // then remove the deployed webresource.
    if (formXmlBefore && formId) {
      const entity = (await client.getFormEntity(formId)) ?? "contact";
      await client.setFormXml(formId, formXmlBefore, entity);
    }
    await client.deleteWebresource(perFileLibrary());
  });
});
