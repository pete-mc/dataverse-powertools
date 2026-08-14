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
//
// It then EDITS the definition and deploys a SECOND time, because create was the only arm the first
// version of this suite covered. Update and delete had never run outside a mock, and "the environment
// ends up matching the file" is the actual promise — a parameter you removed has to disappear from
// Dataverse, not linger. The same edit proves #254: regenerating refreshes the wrappers and leaves the
// implementation you wrote alone.
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
  /** Captured on the first deploy so the re-deploy can prove the API row was UPDATED, not recreated. */
  let customApiIdFirstDeploy: string | undefined;
  // Deliberately NOT Windows-gated. Every step here is cross-platform — `dotnet` builds the package,
  // the rest is Web API — so this suite can run in a Linux CI job under xvfb (#143 Move 5). The guard
  // it used to carry was copied from pluginProfilerReplay, which IS Windows-only because the profiler
  // capture tool is .NET Framework; that reason does not apply to Custom APIs.

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
      // The handler has to be somewhere the plug-in project COMPILES, or the type it declares never
      // reaches the assembly and the Custom API deploy has nothing to point at (#225).
      const outDir = path.join(workspace, projectName, "CustomApi");
      const wrappersPath = path.join(outDir, `${className}.generated.cs`);
      expect(await waitForFile(wrappersPath, 30000), `${projectName}/CustomApi/${className}.generated.cs`).to.equal(true);
      // Two files, not one: the wrappers are regenerated, the implementation is the user's (#254).
      handlerPath = path.join(outDir, `${className}.cs`);
      expect(await waitForFile(handlerPath, 30000), `${projectName}/CustomApi/${className}.cs (the file you own)`).to.equal(true);
      const wrappers = fs.readFileSync(wrappersPath, "utf8");
      expect(wrappers, "the wrappers file has no implementation to lose").to.not.contain(": IPlugin");
      expect(fs.readFileSync(handlerPath, "utf8"), "the implementation is in the file you own").to.contain(": IPlugin");

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
      return `generated CustomApi/${className}.generated.cs + ${className}.cs and clients/${className}.client.ts`;
    });
  });

  // #254 was: regenerating rewrote the single handler file, taking the user's Execute body with it.
  it("keeps YOUR implementation when the handler is regenerated (#254)", async () => {
    await step(COMPONENT, "Regenerate after editing the definition", async () => {
      // Write the implementation the way a user would, then change the definition and regenerate.
      const marker = "// MY-IMPLEMENTATION-MUST-SURVIVE";
      const implemented = fs
        .readFileSync(handlerPath, "utf8")
        .replace(
          /\/\/ TODO: implement the .*\n.*\/\/ Read typed inputs from 'request', set typed outputs on 'response'\./,
          `${marker}\n            response.OutputValue = "echo: " + request.InputValue;`,
        );
      expect(implemented, "the TODO was found and replaced").to.not.contain("// TODO: implement");
      fs.writeFileSync(handlerPath, implemented);

      // A real definition change: a second request parameter the wrappers must pick up.
      const definitionPath = path.join(workspace, `${apiUniqueName}.customapi.json`);
      const def = JSON.parse(fs.readFileSync(definitionPath, "utf8"));
      def.requestParameters.push({
        uniqueName: "Multiplier",
        name: `${apiUniqueName}.Multiplier`,
        displayName: "Multiplier",
        type: "Integer",
        isOptional: true,
        description: "Added to prove regeneration refreshes the wrappers.",
      });
      fs.writeFileSync(definitionPath, JSON.stringify(def, null, 2) + "\n");

      await clearOutput();
      await closeAnyOpenMenu();
      await expandComponentCards();
      await clickOverflowItem("Generate Custom API handlers", { timeoutMs: 45000 });
      // The log states which file was left alone, so the guarantee is visible and not just implied.
      await expectOutput([`✓ ${apiUniqueName}.customapi.json → `, `${className}.cs left as you wrote it`], { step: "regenerate handler", timeoutMs: 120000 });

      const afterUser = fs.readFileSync(handlerPath, "utf8");
      expect(afterUser, "MY implementation survived regeneration").to.contain(marker);
      expect(afterUser, "and so did the line I wrote").to.contain('response.OutputValue = "echo: " + request.InputValue;');
      const afterWrappers = fs.readFileSync(path.join(workspace, projectName, "CustomApi", `${className}.generated.cs`), "utf8");
      expect(afterWrappers, "the wrappers picked up the new parameter").to.contain("public int Multiplier =>");
      return `regenerated after adding Multiplier: wrappers refreshed, ${className}.cs untouched`;
    });
  });

  it("deploys the plug-in package — Build & deploy package", async () => {
    await step(COMPONENT, "Deploy the plug-in package", async () => {
      // The implementation was written in the step above (and survived regeneration), so this compiles
      // real logic — an echo — rather than an empty TODO.
      expect(fs.readFileSync(handlerPath, "utf8"), "the handler implements the echo").to.contain('response.OutputValue = "echo: " + request.InputValue;');

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
      // both request parameters and the one response property created, nothing updated or deleted.
      await expectOutput([`Created CustomAPI '${apiUniqueName}'.`, "Parameters: +2 ~0 -0; Response: +1 ~0 -0."], { step: "deploy custom api", timeoutMs: 300000 });

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
      customApiIdFirstDeploy = customApiId;
      return `customapi ${apiUniqueName} created (${customApiId}) with InputValue + Multiplier → OutputValue`;
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
        // ONE PROMPT PER REQUEST PARAMETER, in definition order. The regeneration step above added
        // Multiplier, so there are two now; answering only the first leaves the command waiting and no
        // call is ever made.
        await answerText("ping"); // InputValue
        await answerText("2"); // Multiplier (optional, but the prompt still appears)
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

  // The create path was proven above. UPDATE and DELETE were only ever unit-tested against a mock, so a
  // second deploy of an EDITED definition is the only thing that shows Dataverse ends up matching the
  // file rather than accumulating whatever earlier versions left behind.
  it("re-deploys an EDITED definition: updates what changed and DELETES what was removed", async () => {
    await step(COMPONENT, "Re-deploy after editing (update + delete reconcile)", async () => {
      const definitionPath = path.join(workspace, `${apiUniqueName}.customapi.json`);
      const def = JSON.parse(fs.readFileSync(definitionPath, "utf8"));
      // 1. change an existing parameter  → update
      const inputValue = def.requestParameters.find((p: any) => p.uniqueName === "InputValue");
      inputValue.displayName = "Input Value (renamed)";
      inputValue.isOptional = true;
      // 2. remove the parameter added earlier → delete
      def.requestParameters = def.requestParameters.filter((p: any) => p.uniqueName !== "Multiplier");
      // 3. add a response property → create, alongside an existing one
      def.responseProperties.push({
        uniqueName: "Echoed",
        name: `${apiUniqueName}.Echoed`,
        displayName: "Echoed",
        type: "Boolean",
        description: "Added on the second deploy.",
      });
      // 4. change the API row itself → the "Updated CustomAPI" arm rather than "Created"
      def.displayName = `${apiUniqueName} (renamed)`;
      fs.writeFileSync(definitionPath, JSON.stringify(def, null, 2) + "\n");

      await clearOutput();
      await closeAnyOpenMenu();
      await expandComponentCards();
      await clickOverflowItem("Deploy Custom APIs", { timeoutMs: 45000 });
      const summary = await expectOutput([`Updated CustomAPI '${apiUniqueName}'.`, "Parameters: +", "Response: +"], { step: "re-deploy custom api", timeoutMs: 300000 });
      const counts = /Parameters: (\+\d+ ~\d+ -\d+); Response: (\+\d+ ~\d+ -\d+)\./.exec(summary);
      console.log(`    [e2e] reconcile summary — Parameters: ${counts?.[1] ?? "?"}; Response: ${counts?.[2] ?? "?"}`);
      expect(summary, "a request parameter was deleted").to.match(/Parameters: \+\d+ ~\d+ -[1-9]/);

      // Assert the EFFECT in Dataverse, not the counts: the environment must match the file now.
      const customApiId = await client.findCustomApiId(apiUniqueName);
      expect(customApiId, "the API is still there (updated, not recreated)").to.equal(customApiIdFirstDeploy);
      const row = await client.getCustomApi(apiUniqueName);
      expect(row?.displayname, "the display name change was applied").to.equal(`${apiUniqueName} (renamed)`);

      const members = await client.getCustomApiMembers(customApiId!);
      expect(members.requestParameters, "the kept parameter is still there").to.include("InputValue");
      expect(members.requestParameters, "the REMOVED parameter is gone from the environment").to.not.include("Multiplier");
      expect(members.responseProperties, "the original response property is still there").to.include("OutputValue");
      expect(members.responseProperties, "the ADDED response property was created").to.include("Echoed");
      return `re-deploy reconciled: InputValue updated, Multiplier deleted, Echoed created, API row updated in place (${customApiId})`;
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
