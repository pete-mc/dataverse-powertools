import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { By, Key, TextEditor, VSBrowser, WebElement, WebView } from "vscode-extension-tester";
import {
  loadE2EEnv,
  freshWorkspace,
  answerText,
  answerFlexible,
  pickByLabel,
  runCommand,
  waitForFile,
  dismissOverlays,
  sleep,
  expectOutput,
  clearOutput,
  E2EClient,
  resetAllCredentials,
  shot,
  shotWithHighlight,
} from "./lib";

// End-to-end for the FetchXML query tools (#238), driving the LITERAL VS Code UI.
//
// What only this layer can prove: the CodeLens really appears on FetchXML in the user's own file,
// the run really reaches the environment and returns rows, the generator webview really loads under its
// CSP and its edits really reach the host — and, the one that matters most, that saving really
// rewrites the source file and leaves the rest of it alone.
//
// Every step is gated on the extension's own FINAL log line via expectOutput, never on a sleep or an
// intermediate artifact, so a step cannot start while the previous command is still running.
// Quick picks are answered by keyboard (type-to-filter + Enter), never by clicking a row: closing all
// editors reveals the watermark whose hints sit over the quick-pick rows and intercept clicks.
//
// Self-skips without sandbox/.env.
describe("FetchXML query tools (e2e)", function () {
  this.timeout(900000);
  const env = loadE2EEnv();
  let workspace: string;
  let solutionFriendlyName: string;

  /** A plugin-style C# file: verbatim FetchXML, one interpolated GUID, handed to FetchExpression. */
  const CSHARP_FILE = "QueryProbe.cs";
  const CSHARP_SOURCE = `using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace DvptQueryProbe
{
    public class QueryProbe
    {
        // A marker the write-back test asserts is still present afterwards.
        public const string Marker = "DO-NOT-TOUCH";

        public EntityCollection OpenCasesFor(IOrganizationService service, Guid accountId)
        {
            var fetchXml = $@"<fetch top='50'>
  <entity name='account'>
    <attribute name='name' />
    <filter type='and'>
      <condition attribute='accountid' operator='eq' value='{accountId}' />
    </filter>
  </entity>
</fetch>";
            return service.RetrieveMultiple(new FetchExpression(fetchXml));
        }
    }
}
`;

  /** A web-resource-style TS file: a template literal with an UNESCAPED string interpolation. */
  const TS_FILE = "queryProbe.ts";
  const TS_SOURCE = `export async function findAccounts(term: string): Promise<void> {
  const fetchXml = \`<fetch top='25'>
  <entity name='account'>
    <attribute name='name' />
    <filter type='and'>
      <condition attribute='name' operator='like' value='%\${term}%' />
    </filter>
  </entity>
</fetch>\`;
  await Xrm.WebApi.retrieveMultipleRecords("account", "?fetchXml=" + encodeURIComponent(fetchXml));
}
`;

  const csharpPath = (): string => path.join(workspace, CSHARP_FILE);
  const tsPath = (): string => path.join(workspace, TS_FILE);

  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      try {
        const dir = path.resolve(__dirname, "..", "..", "..", "sandbox", "screenshots-out");
        fs.mkdirSync(dir, { recursive: true });
        const img = await VSBrowser.instance.driver.takeScreenshot();
        const name = (this.currentTest?.title || "step").replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
        fs.writeFileSync(path.join(dir, `e2e-fail-fetchxml-${name}.png`), img, "base64");
      } catch {
        /* ignore */
      }
    }
  });

  /** Read visible notification text BEFORE dismissing overlays, so a command error can be asserted.
   * File asserts alone are not enough: a command can error AFTER writing (see CLAUDE.md). */
  async function assertCommandDidNotError(context: string): Promise<void> {
    await sleep(3000);
    let text = "";
    try {
      text = String(
        (await VSBrowser.instance.driver.executeScript(
          "return Array.from(document.querySelectorAll('.notification-list-item-message, .notification-toast, .monaco-dialog-box')).map(function(e){return e.textContent || '';}).join(' ||| ');",
        )) ?? "",
      );
    } catch {
      /* no readable notifications */
    }
    expect(/resulted in an error/i.test(text), `${context}: a command surfaced an error notification — "${text.slice(0, 300)}"`).to.equal(false);
  }

  /** Open a workspace file and settle. */
  async function openFile(file: string): Promise<void> {
    await VSBrowser.instance.openResources(file);
    await sleep(2500);
    await dismissOverlays();
  }

  /** The titles of the CodeLenses currently shown in the active editor. */
  async function lensTitles(): Promise<string[]> {
    const deadline = Date.now() + 30000;
    let titles: string[] = [];
    while (Date.now() < deadline) {
      try {
        const editor = new TextEditor();
        const lenses = await editor.getCodeLenses();
        titles = await Promise.all(lenses.map((lens) => lens.getText()));
        if (titles.some((title) => title.includes("Run"))) {
          return titles;
        }
      } catch {
        /* lenses resolve asynchronously — retry */
      }
      await sleep(2000);
    }
    return titles;
  }

  /** Click a CodeLens by (partial) title. */
  async function clickLens(match: string): Promise<void> {
    const editor = new TextEditor();
    const lenses = await editor.getCodeLenses();
    for (const lens of lenses) {
      if ((await lens.getText()).includes(match)) {
        await lens.click();
        return;
      }
    }
    throw new Error(`no CodeLens matching "${match}" — saw: ${(await Promise.all(lenses.map((l) => l.getText()))).join(" | ")}`);
  }

  /**
   * Interact with an element inside the webview, re-finding it and retrying on staleness.
   *
   * The generator's renderer replaces its children wholesale on every state push, so any element
   * reference held across an edit round trip goes stale. This is why the value is typed in ONE
   * sendKeys ending in TAB below — a `clear()` first would fire its own `change`, trigger a
   * re-render, and invalidate the very element being typed into (which is exactly how this step
   * failed the first time it ran).
   */
  async function inFrame<T>(webview: WebView, selector: string, action: (element: WebElement) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await action(await webview.findWebElement(By.css(selector)));
      } catch (error) {
        if (attempt >= 3 || !/stale element/i.test(String(error))) {
          throw error;
        }
        await sleep(1000);
      }
    }
  }

  /** Switch into the generator webview, verified by its own #tree marker. */
  async function openGeneratorFrame(): Promise<WebView> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const webview = new WebView();
      try {
        await webview.switchToFrame(5000);
        if ((await webview.findWebElements(By.css("#tree .row"))).length > 0) {
          return webview;
        }
        await webview.switchBack();
      } catch {
        try {
          await webview.switchBack();
        } catch {
          /* not in a frame */
        }
      }
      await sleep(2000);
    }
    throw new Error("could not switch into the FetchXML Generator webview (no #tree rows found)");
  }

  before(async function () {
    if (!env) {
      this.skip();
    }
    const client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;

    workspace = freshWorkspace("fetchxml");
    // The probe files exist before the workspace opens, so the CodeLens provider sees them
    // immediately — this suite tests the query tools, not scaffolding.
    fs.writeFileSync(csharpPath(), CSHARP_SOURCE, "utf8");
    fs.writeFileSync(tsPath(), TS_SOURCE, "utf8");

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

  it("connects the workspace with a connection-only root", async () => {
    const log = (m: string) => console.log(`    [e2e] ${m}`);
    log("running Initialise Project");
    // Fresh-credential isolation: this suite proves its own auth path from zero.
    await resetAllCredentials(log);
    await runCommand("Dataverse PowerTools: Initialise Project");
    // A connection-only root: this suite needs a live connection, not a scaffolded component.
    await pickByLabel("Multi-component project (two or more types)");
    await pickByLabel("Service principal (client secret)");
    await answerText(env!.tenantId);
    await answerText(env!.clientId);
    await answerText(env!.clientSecret);
    await answerFlexible(env!.url);
    await pickByLabel(solutionFriendlyName);
    await sleep(5000);
    await dismissOverlays();

    expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 120000), "root dataverse-powertools.json").to.equal(true);
    const settings = JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8"));
    expect(settings.connectionString, "the root carries the connection").to.be.a("string").and.not.equal("");
  });

  it("shows the Run and generator CodeLens on FetchXML in a C# file", async () => {
    await openFile(csharpPath());
    const titles = await lensTitles();
    expect(
      titles.some((title) => title.includes("Run")),
      `expected a Run lens on the C# query — saw: ${titles.join(" | ")}`,
    ).to.equal(true);
    expect(
      titles.some((title) => title.includes("generator")),
      `expected an "Edit in generator" lens — saw: ${titles.join(" | ")}`,
    ).to.equal(true);
    // Wiki frame: the lens as it appears on a query already sitting in your own code.
    await shotWithHighlight(".codelens-decoration a", "fetchxml-01-codelens-csharp", { text: "Run" });
  });

  it("shows the CodeLens on a TypeScript template-literal query, and flags the unescaped value", async () => {
    await openFile(tsPath());
    const titles = await lensTitles();
    expect(
      titles.some((title) => title.includes("Run")),
      `expected a Run lens on the TypeScript query — saw: ${titles.join(" | ")}`,
    ).to.equal(true);
    // `${term}` is a raw string interpolated into an XML attribute — the diagnostic that pays for
    // itself, surfaced as the "N issues" lens.
    expect(
      titles.some((title) => title.includes("issue")),
      `expected an issues lens for the unescaped value — saw: ${titles.join(" | ")}`,
    ).to.equal(true);
    // Wiki frame: the same lens on a TypeScript template literal, flagging the unescaped value.
    await shotWithHighlight(".codelens-decoration a", "fetchxml-02-codelens-typescript", { text: "issue" });
  });

  it("runs the C# query against the environment and returns rows", async () => {
    await clearOutput();
    await openFile(csharpPath());
    await lensTitles(); // wait for the lenses to resolve before clicking one
    await clickLens("Run");

    // Wiki frame: the prompt that asks for the placeholder's value before the query runs.
    await sleep(2500);
    await shot("fetchxml-03-parameter-prompt");
    // One parameter (accountId, inferred Uniqueidentifier from the column) — the prompt validates it,
    // so an all-zero GUID is accepted and simply matches nothing.
    await answerText("00000000-0000-0000-0000-000000000000");

    // Gate on the run's FINAL line. Metadata has to load first (the entity SET name comes from it),
    // so allow for that round trip.
    const text = await expectOutput(["[Query] GET accounts", "row(s) returned"], { step: "run C# query", timeoutMs: 240000 });
    expect(/\[Query\] \d+ row\(s\) returned/.test(text), "the run logged a row count").to.equal(true);
    await assertCommandDidNotError("run C# query");
    // Wiki frame: the results view for that run.
    await sleep(2000);
    await shot("fetchxml-04-results");
  });

  it("opens the generator on the C# query with the parameter bound to the code expression", async () => {
    await openFile(csharpPath());
    await lensTitles();
    await clickLens("generator");
    // FINAL signal for the open: state rendered. 5 elements = fetch/entity/attribute/filter/condition.
    await expectOutput(["[Query] Generator ready for QueryProbe.cs", "5 elements"], { step: "open generator", timeoutMs: 120000 });

    const webview = await openGeneratorFrame();
    try {
      const rows = await webview.findWebElements(By.css("#tree .row"));
      expect(rows.length, "the tree renders one row per element").to.equal(5);
      const labels = await Promise.all(rows.map((row) => row.getText()));
      expect(labels.join(" | "), "the tree reads like the query").to.contain("account");

      // The parameter is bound to the code expression, not invented by the generator.
      const parameterInputs = await webview.findWebElements(By.css("#parameters input"));
      expect(parameterInputs.length, "one parameter row for {accountId}").to.equal(1);
      const parameterText = await (await webview.findWebElement(By.css("#parameters"))).getText();
      expect(parameterText, "the parameter names itself after the variable").to.contain("accountId");
    } finally {
      await webview.switchBack();
    }
    // Wiki frame: the generator itself. Taken AFTER switching back out of the webview frame — a
    // screenshot while the driver is inside an iframe context captures the frame, not the window.
    await shot("fetchxml-05-generator");
  });

  it("writes an edit from the generator back into the C# file, leaving the rest of it untouched", async () => {
    await clearOutput();
    const before = fs.readFileSync(csharpPath(), "utf8");
    expect(before, "starts at top='50'").to.contain("top='50'");

    await openFile(csharpPath());
    await lensTitles();
    await clickLens("generator");
    await expectOutput(["[Query] Generator ready for QueryProbe.cs"], { step: "open generator for edit", timeoutMs: 120000 });

    const webview = await openGeneratorFrame();
    try {
      // The root <fetch> is selected by default, so its Top field is on screen. Select-all, type the
      // new value and TAB out in one go: the field commits on `change`, i.e. once, at blur.
      await inFrame(webview, "#field-top", (element) => element.sendKeys(Key.chord(Key.CONTROL, "a"), "7", Key.TAB));
      await sleep(2500); // the host applies the edit and pushes fresh state

      expect(await inFrame(webview, "#save", (element) => element.isEnabled()), "Save enables once there are unsaved changes").to.equal(true);
      await inFrame(webview, "#save", (element) => element.click());
    } finally {
      await webview.switchBack();
    }

    await expectOutput(["[Query] Wrote the edited query back to"], { step: "save to code", timeoutMs: 120000 });
    await assertCommandDidNotError("save to code");

    // The file really changed...
    const after = await (async () => {
      const deadline = Date.now() + 30000;
      for (;;) {
        const text = fs.readFileSync(csharpPath(), "utf8");
        if (text.includes("top='7'") || Date.now() > deadline) {
          return text;
        }
        await sleep(2000);
      }
    })();
    expect(after, "the edit landed in the source file").to.contain("top='7'");
    expect(after, "the old value is gone").to.not.contain("top='50'");
    // ...and nothing else did: the surrounding code, the interpolation, and the literal's form.
    expect(after, "the interpolated expression is preserved verbatim").to.contain("{accountId}");
    expect(after, "the literal stays an interpolated verbatim string").to.contain('$@"<fetch');
    expect(after, "surrounding code is untouched").to.contain('public const string Marker = "DO-NOT-TOUCH";');
    expect(after, "the method signature is untouched").to.contain("public EntityCollection OpenCasesFor(IOrganizationService service, Guid accountId)");
  });

  it("re-detects the edited query, so the round trip is stable", async () => {
    await openFile(csharpPath());
    const titles = await lensTitles();
    expect(
      titles.some((title) => title.includes("Run")),
      `the rewritten query is still detected — saw: ${titles.join(" | ")}`,
    ).to.equal(true);
  });

  it("clears the metadata cache", async () => {
    await clearOutput();
    await runCommand("Dataverse PowerTools: Clear Dataverse Metadata Cache");
    await expectOutput(["[Query] Metadata cache cleared."], { step: "clear metadata cache", timeoutMs: 60000 });
    await assertCommandDidNotError("clear metadata cache");
  });
});
