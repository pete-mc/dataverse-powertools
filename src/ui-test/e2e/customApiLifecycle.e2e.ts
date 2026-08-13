import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { Key, VSBrowser } from "vscode-extension-tester";
import { loadE2EEnv, freshWorkspace, answerText, pickByLabel, waitForFile, dismissOverlays, sleep, expectOutput, clearOutput, E2EClient } from "./lib";
import { clickPanelButton, clickOverflowItem, expandComponentCards } from "../supervised/supervisedLib";
import { initProject, step, showLog } from "./acceptanceLib";

// ACCEPTANCE (button-driven, live Dataverse): the Custom API loop, end to end — define, generate the
// handler and the typed client, deploy the plug-in package, deploy the API, then CALL IT and check the
// response.
//
// This suite exists because nothing had ever exercised those wire calls (#225). Both files said so in
// their own source: deployCustomApi's create/update/delete "have not yet been run against a live
// environment", and invokeCustomApi's HTTP call likewise. Six unit specs cover the pure parts — the
// definition format, the payload shapes, the reconcile plan, the generated code — none of which can
// catch a 400 from Dataverse or a swallowed failure, the exact shape of #129 (early-bound reporting
// success with zero files written because pac exits 0 on failure).
//
// What only this layer can prove:
//   * the customapi row, its request parameters and its response properties really land, with the
//     values the definition asked for;
//   * the deploy finds the plug-in type it needs (the package import has to have created it);
//   * invoking the message actually returns the handler's output, so the whole path — request wrapper,
//     InputParameters, the plug-in, OutputParameters, response wrapper — is connected.
//
// The generated handler is a stub with a TODO, so the test writes one line of real implementation into
// it (echo the input) before deploying: without that the call would return 200 and nothing, which would
// prove the plumbing while proving nothing about the data.
const COMPONENT = "Custom API";

/**
 * Close a panel overflow menu left open by an earlier step.
 *
 * The menu lives inside the panel's webview, so `dismissOverlays` (which works on the main document)
 * cannot reach it — and while it is open the panel's own buttons are unreachable, which turned one failed
 * step into a cascade of "button not found".
 */
const escapeKey = Key.ESCAPE;

async function closeAnyOpenMenu(): Promise<void> {
  try {
    await VSBrowser.instance.driver.actions().sendKeys(escapeKey).perform();
    await sleep(500);
    await VSBrowser.instance.driver.actions().sendKeys(escapeKey).perform();
  } catch {
    /* best-effort */
  }
  await dismissOverlays();
  await sleep(500);
}

describe("ACCEPTANCE: Custom API — define, deploy and execute via panel buttons", function () {
  this.timeout(3600000);
  const env = loadE2EEnv();
  let workspace: string;
  let solutionFriendlyName: string;
  let client: E2EClient;
  const projectName = "CustomApiE2E";
  const packageName = "CustomApiE2E";
  /** Unique per run: a leftover row from an earlier run would make "created" un-provable. */
  const apiUniqueName = `dvpt_Echo${Date.now().toString().slice(-6)}`;
  const className = `Echo${Date.now().toString().slice(-6)}`;
  let pluginTypeName = "";
  let handlerPath = "";
  const isWindows = process.platform === "win32";

  function pkgUnique(): string {
    const settings = JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8"));
    return `${settings.prefix ?? env?.prefix}_${packageName}`;
  }

  before(async function () {
    if (!env || !isWindows) {
      this.skip();
    }
    client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;
    workspace = freshWorkspace("acc-customapi");
    await VSBrowser.instance.openResources(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    await showLog();
  });

  it("starts a Plugins project (Initialise button + wizard)", async () => {
    await step(COMPONENT, "Scaffold the plugin project that will implement the API", async () => {
      await initProject("Plugins", env!, solutionFriendlyName, async () => {
        await answerText(projectName); // plugin project name
        await answerText(packageName); // plugin package name
        await answerText("1.0.0"); // version
        await pickByLabel("No", 600000); // set up unit testing? (not needed here)
        await pickByLabel("No", 300000); // create a plugin class? the Custom API generator writes ours
      });
      expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 300000), "project scaffolded").to.equal(true);
      return `scaffolded ${projectName} (plugin package ${packageName})`;
    });
  });

  it("creates a Custom API definition — New Custom API definition", async () => {
    await step(COMPONENT, "Create the definition file", async () => {
      await clearOutput();
      await closeAnyOpenMenu();
      await expandComponentCards();
      await clickOverflowItem("New Custom API definition", { timeoutMs: 45000 });
      await answerText(apiUniqueName); // unique name
      pluginTypeName = `${projectName}.${className}`;
      await answerText(pluginTypeName); // plug-in type that implements it
      // Written at the COMPONENT root, which for a root-initialised project is the workspace root — the
      // plugin .csproj lives a level down in ${projectName}/.
      const definitionPath = path.join(workspace, `${apiUniqueName}.customapi.json`);
      expect(await waitForFile(definitionPath, 60000), `${apiUniqueName}.customapi.json`).to.equal(true);

      // The scaffold has to be a valid, Global, non-function API with one in and one out — everything
      // downstream (handler shape, invoke prompts, the assertions below) reads from it.
      const def = JSON.parse(fs.readFileSync(definitionPath, "utf8"));
      expect(def.binding, "scaffolded as Global (unbound)").to.equal("Global");
      expect(def.isFunction, "scaffolded as an Action, not a Function").to.equal(false);
      expect(
        def.requestParameters.map((p: any) => p.uniqueName),
        "one request parameter",
      ).to.deep.equal(["InputValue"]);
      expect(
        def.responseProperties.map((p: any) => p.uniqueName),
        "one response property",
      ).to.deep.equal(["OutputValue"]);
      await expectOutput([`Created Custom API definition`], { step: "new definition", timeoutMs: 60000 });
      return `wrote ${apiUniqueName}.customapi.json (Global action, InputValue → OutputValue)`;
    });
  });

  it("generates the C# handler and the typed TypeScript client", async () => {
    await step(COMPONENT, "Generate handler + client", async () => {
      await clearOutput();
      await closeAnyOpenMenu();
      await expandComponentCards();
      await clickOverflowItem("Generate Custom API handlers", { timeoutMs: 45000 });
      // The log names the DEFINITION FILE, not the unique name: "✓ dvpt_X.customapi.json → …".
      await expectOutput([`✓ ${apiUniqueName}.customapi.json → `, `${className}.generated.cs`], { step: "generate handler", timeoutMs: 120000 });
      // The handler has to end up somewhere the plug-in project COMPILES, or the type it declares never
      // reaches the assembly and the Custom API deploy has nothing to point at. Accept either location
      // for now and record which one, so the run shows the whole consequence chain rather than stopping
      // at the first symptom.
      const atComponentRoot = path.join(workspace, "CustomApi", `${className}.generated.cs`);
      const inPluginProject = path.join(workspace, projectName, "CustomApi", `${className}.generated.cs`);
      const found = (await waitForFile(inPluginProject, 30000)) ? inPluginProject : (await waitForFile(atComponentRoot, 30000)) ? atComponentRoot : undefined;
      expect(found, `${className}.generated.cs written somewhere`).to.not.equal(undefined);
      handlerPath = found!;
      const buildable = handlerPath.startsWith(path.join(workspace, projectName) + path.sep);
      console.log(`    [e2e] handler written to ${path.relative(workspace, handlerPath)} — ${buildable ? "inside" : "OUTSIDE"} the plug-in project`);
      expect(buildable, `the generated handler is inside ${projectName}/ so dotnet build compiles it`).to.equal(true);

      await clearOutput();
      await closeAnyOpenMenu();
      await expandComponentCards();
      await clickOverflowItem("Generate Custom API TS clients", { timeoutMs: 45000 });
      await expectOutput([`✓ ${apiUniqueName}.customapi.json → clients/`], { step: "generate client", timeoutMs: 120000 });
      // The client is TypeScript for a web-resource/PCF project, so the component root is right for it.
      // It is named after the plug-in CLASS, not the API's unique name.
      const clientFile = path.join(workspace, "clients", `${className}.client.ts`);
      expect(await waitForFile(clientFile, 60000), `clients/${className}.client.ts`).to.equal(true);

      // The generated client must be usable: the typed request/response and the message name.
      const clientSource = fs.readFileSync(clientFile, "utf8");
      expect(clientSource, "the client calls the API by its unique name").to.contain(apiUniqueName);
      expect(clientSource, "the client types the request parameter").to.contain("InputValue");
      expect(clientSource, "the client types the response property").to.contain("OutputValue");
      return `generated CustomApi/${className}.generated.cs and clients/${apiUniqueName}.ts`;
    });
  });

  it("implements the handler, then deploys the package — Build & deploy package", async () => {
    await step(COMPONENT, "Implement + deploy the plug-in package", async () => {
      // Replace the generated TODO with the one line a user would write. Done here rather than in the
      // template so regenerating never silently overwrites real logic.
      const handler = handlerPath;
      const source = fs.readFileSync(handler, "utf8");
      const implemented = source.replace(
        /\/\/ TODO: implement the .*\n.*\/\/ Read typed inputs from 'request', set typed outputs on 'response'\./,
        `response.OutputValue = "echo: " + request.InputValue;`,
      );
      expect(implemented, "the TODO was found and replaced").to.not.equal(source);
      fs.writeFileSync(handler, implemented);

      await clearOutput();
      await closeAnyOpenMenu();
      await expandComponentCards();
      // `contains` because the primary button carries a "▶ " prefix.
      await clickPanelButton("Build & deploy package", { timeoutMs: 45000, contains: true });
      await expectOutput(["Build Package & Deploy completed."], { step: "build & deploy package", timeoutMs: 900000 });

      const packageId = await client.findPluginPackageId(pkgUnique());
      expect(packageId, `plugin package ${pkgUnique()} in Dataverse`).to.not.equal(undefined);
      // The Custom API deploy resolves the plug-in TYPE by name; the package import is what creates it.
      // If this is undefined the next step cannot work, and the reason is here rather than in a vague
      // "not found" message.
      const typeId = await (async (): Promise<string | undefined> => {
        const deadline = Date.now() + 180000;
        for (;;) {
          const id = await client.findPluginTypeId(pluginTypeName);
          if (id || Date.now() > deadline) {
            return id;
          }
          await sleep(5000);
        }
      })();
      expect(typeId, `plugin type ${pluginTypeName} registered by the package import`).to.not.equal(undefined);
      return `deployed ${pkgUnique()}; plug-in type ${pluginTypeName} exists (${typeId})`;
    });
  });

  it("deploys the Custom API — and the rows really land in Dataverse", async () => {
    await step(COMPONENT, "Deploy Custom APIs", async () => {
      await clearOutput();
      await closeAnyOpenMenu();
      await expandComponentCards();
      await clickOverflowItem("Deploy Custom APIs", { timeoutMs: 45000 });
      // Gate on the reconcile SUMMARY, not on "Created CustomAPI": that line is written before the
      // request parameters and response properties are reconciled, so verifying Dataverse on it found
      // the API and its parameter but not yet its response property. The counts also assert the plan —
      // one of each created, nothing updated, nothing deleted.
      await expectOutput([`Created CustomAPI '${apiUniqueName}'.`, "Parameters: +1 ~0 -0; Response: +1 ~0 -0."], { step: "deploy custom api", timeoutMs: 300000 });

      const customApiId = await client.findCustomApiId(apiUniqueName);
      expect(customApiId, `customapi row for ${apiUniqueName}`).to.not.equal(undefined);
      // Verify against Dataverse, not against our own log line: a POST that 400s and is swallowed would
      // still print progress.
      const row = await client.getCustomApi(apiUniqueName);
      expect(row?.bindingtype, "stored as Global (bindingtype 0)").to.equal(0);
      expect(row?.isfunction, "stored as an Action").to.equal(false);
      expect(row?.plugintypeid, "wired to the plug-in type").to.not.equal(undefined);

      const members = await client.getCustomApiMembers(customApiId!);
      expect(members.requestParameters, "the request parameter was created").to.include("InputValue");
      expect(members.responseProperties, "the response property was created").to.include("OutputValue");
      return `customapi ${apiUniqueName} created (${customApiId}) with InputValue → OutputValue`;
    });
  });

  it("EXECUTES the Custom API and returns the handler's output — Run Custom API…", async () => {
    await step(COMPONENT, "Run Custom API and check the response", async () => {
      await clearOutput();
      await closeAnyOpenMenu();
      await expandComponentCards();
      // A freshly-created message can take a moment to be callable; retry the whole invoke rather than
      // asserting on the first attempt.
      let responseText = "";
      const deadline = Date.now() + 420000;
      for (let attempt = 1; ; attempt++) {
        await clickOverflowItem("Run Custom API…", { timeoutMs: 45000 });
        // No "which Custom API?" pick: that quick pick only appears with MORE than one definition in the
        // component, and this suite creates exactly one — so the next prompt is the parameter itself.
        await answerText("ping"); // InputValue
        try {
          // "POST dvpt_Echo…" — the logged path has no leading slash.
          responseText = await expectOutput([`POST ${apiUniqueName}`, "Response:"], { step: `invoke custom api (attempt ${attempt})`, timeoutMs: 120000 });
          break;
        } catch (error) {
          if (Date.now() > deadline) {
            throw error;
          }
          console.log(`    [e2e] invoke attempt ${attempt} did not answer yet — the message may still be publishing; retrying.`);
          await clearOutput();
          await sleep(20000);
        }
      }

      // The response has to carry the handler's OutputValue: that is the only thing proving the call
      // reached the plug-in and came back, rather than merely returning 204.
      expect(responseText, "the response contains the handler's OutputValue").to.contain("OutputValue");
      expect(responseText, "the handler echoed the input we passed").to.contain("echo: ping");
      return `called ${apiUniqueName} with InputValue="ping" and got OutputValue="echo: ping"`;
    });
  });

  after(async function () {
    // Remove the Custom API first: its members reference it, and the plug-in type cannot be removed
    // while a Custom API points at it.
    try {
      const removed = await client.deleteCustomApi(apiUniqueName);
      if (removed) {
        console.log(`[cleanup] deleted Custom API ${apiUniqueName} and its members`);
      }
    } catch (error) {
      console.log(`[cleanup] could not delete Custom API ${apiUniqueName}: ${String(error).slice(0, 120)}`);
    }
    try {
      await client.deletePluginPackage(pkgUnique());
    } catch {
      /* best-effort */
    }
  });
});
