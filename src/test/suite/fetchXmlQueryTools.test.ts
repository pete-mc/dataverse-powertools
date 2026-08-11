import * as assert from "assert";
import * as vscode from "vscode";
import { PREVIEW_FEATURES } from "../../general/previewFeatures";

// Integration test (real VS Code extension host) for the FetchXML query tools (#238). The pure
// detection/write-back logic is unit-tested; what only a real host can prove is that the commands,
// the CodeLens provider and the diagnostics are actually wired up — and that the preview gate really
// suppresses them, which is the whole basis of shipping the feature disabled.

const EXTENSION_ID = "dataversepowertools.dataverse-powertools";

const QUERY_COMMANDS = ["dataverse-powertools.openFetchXmlGenerator", "dataverse-powertools.runFetchXml", "dataverse-powertools.clearQueryMetadataCache"];

const CSHARP_WITH_QUERY = `using Microsoft.Xrm.Sdk;
public class Demo
{
    public void Run(IOrganizationService service, System.Guid accountId)
    {
        var result = service.RetrieveMultiple(new Microsoft.Xrm.Sdk.Query.FetchExpression($@"<fetch top='50'>
  <entity name='incident'>
    <attribute name='title' />
    <filter type='and'>
      <condition attribute='customerid' operator='eq' value='{accountId}' />
    </filter>
  </entity>
</fetch>"));
    }
}`;

const TYPESCRIPT_WITH_QUERY = `export async function run(term: string): Promise<void> {
  const fetchXml = \`<fetch top='50'>
  <entity name='account'>
    <attribute name='name' />
    <filter type='and'>
      <condition attribute='name' operator='like' value='%\${term}%' />
    </filter>
  </entity>
</fetch>\`;
  await Xrm.WebApi.retrieveMultipleRecords("account", "?fetchXml=" + encodeURIComponent(fetchXml));
}`;

/** Open an untitled document of a given language so the providers run against it. */
async function openDocument(language: string, content: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument({ language, content });
  await vscode.window.showTextDocument(document, { preview: false });
  return document;
}

async function setPreviewFeatures(enabled: boolean): Promise<void> {
  await vscode.workspace.getConfiguration().update("dataverse-powertools.previewFeatures", enabled, vscode.ConfigurationTarget.Global);
}

async function lensesFor(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
  return (await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", document.uri)) ?? [];
}

suite("FetchXML query tools (integration)", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found in the host`);
    await ext.activate();
  });

  suiteTeardown(async () => {
    await setPreviewFeatures(false);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("the three commands are registered globally at activation", async () => {
    // Registered ONCE in activate(), never in a per-component initialise* — a second component of
    // the same type would otherwise throw "command already exists" (#47).
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = QUERY_COMMANDS.filter((id) => !registered.has(id));
    assert.deepStrictEqual(missing, [], `query commands not registered: ${missing.join(", ")}`);
  });

  test("the preview feature owns exactly those commands", () => {
    const feature = PREVIEW_FEATURES.find((candidate) => candidate.id === "fetchXmlQueries");
    assert.ok(feature, "the fetchXmlQueries preview feature should exist");
    assert.deepStrictEqual([...feature.commands].sort(), [...QUERY_COMMANDS].sort());
    assert.ok(feature.manualTestIssue > 0, "it needs a manual-test sign-off issue");
  });

  test("no CodeLens appears while preview features are off", async function () {
    this.timeout(30000);
    await setPreviewFeatures(false);
    const document = await openDocument("csharp", CSHARP_WITH_QUERY);
    assert.deepStrictEqual(await lensesFor(document), [], "the gate must suppress the lens entirely");
  });

  test("the lens appears on a C# query once preview features are on", async function () {
    this.timeout(30000);
    await setPreviewFeatures(true);
    const document = await openDocument("csharp", CSHARP_WITH_QUERY);
    const lenses = await lensesFor(document);
    const titles = lenses.map((lens) => lens.command?.title ?? "");
    assert.ok(
      titles.some((title) => title.includes("Run")),
      `expected a Run lens, got: ${titles.join(" | ")}`,
    );
    assert.ok(
      titles.some((title) => title.includes("generator")),
      `expected a generator lens, got: ${titles.join(" | ")}`,
    );
    // Every lens sits on the line the literal starts on.
    const literalLine = document.positionAt(document.getText().indexOf('$@"<fetch')).line;
    for (const lens of lenses) {
      assert.strictEqual(lens.range.start.line, literalLine, "the lens should sit on the line the query starts on");
    }
  });

  test("the lens appears on a TypeScript query too", async function () {
    this.timeout(30000);
    await setPreviewFeatures(true);
    const document = await openDocument("typescript", TYPESCRIPT_WITH_QUERY);
    const titles = (await lensesFor(document)).map((lens) => lens.command?.title ?? "");
    assert.ok(
      titles.some((title) => title.includes("Run")),
      `expected a Run lens in TypeScript, got: ${titles.join(" | ")}`,
    );
  });

  test("a file with no FetchXML gets no lens", async function () {
    this.timeout(30000);
    await setPreviewFeatures(true);
    const document = await openDocument("csharp", 'public class Empty { public string Name => "nothing here"; }');
    assert.deepStrictEqual(await lensesFor(document), []);
  });

  test("the unescaped-value warning is published as a diagnostic with a quick fix", async function () {
    this.timeout(30000);
    await setPreviewFeatures(true);
    // A string value interpolated raw into an attribute — the finding that pays for itself.
    const document = await openDocument(
      "csharp",
      `public class Demo { public void Run(string term) { var x = new FetchExpression($@"<fetch><entity name='account'><filter><condition attribute='name' operator='like' value='%{term}%' /></filter></entity></fetch>"); } }`,
    );

    // Diagnostics are published on open/change; give the provider a turn of the event loop.
    const diagnostics = await waitFor(() => {
      const found = vscode.languages.getDiagnostics(document.uri).filter((diagnostic) => diagnostic.source === "Dataverse PowerTools");
      return found.length > 0 ? found : undefined;
    });
    assert.ok(diagnostics, "expected a Dataverse PowerTools diagnostic on the unescaped value");
    assert.ok(
      diagnostics.some((diagnostic) => diagnostic.code === "unescapedValue"),
      `expected an unescapedValue diagnostic, got: ${diagnostics.map((d) => String(d.code)).join(", ")}`,
    );

    const target = diagnostics.find((diagnostic) => diagnostic.code === "unescapedValue") as vscode.Diagnostic;
    const actions = (await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", document.uri, target.range)) ?? [];
    assert.ok(
      actions.some((action) => action.title.includes("SecurityElement.Escape")),
      `expected an escaping quick fix, got: ${actions.map((action) => action.title).join(" | ")}`,
    );
  });

  test("diagnostics are withdrawn when the preview flag goes off", async function () {
    this.timeout(30000);
    await setPreviewFeatures(true);
    const document = await openDocument("csharp", CSHARP_WITH_QUERY);
    await waitFor(() => (vscode.languages.getDiagnostics(document.uri).length >= 0 ? true : undefined));

    await setPreviewFeatures(false);
    const cleared = await waitFor(() => (vscode.languages.getDiagnostics(document.uri).filter((d) => d.source === "Dataverse PowerTools").length === 0 ? true : undefined));
    assert.ok(cleared, "the gate must withdraw the diagnostics too");
  });

  test("running with no FetchXML at the cursor reports it instead of throwing", async function () {
    this.timeout(30000);
    await setPreviewFeatures(true);
    await openDocument("csharp", "public class Empty { }");
    // Resolves rather than rejecting: the command tells the user and returns.
    await vscode.commands.executeCommand("dataverse-powertools.runFetchXml");
  });

  test("clearing the metadata cache works without a connection", async function () {
    this.timeout(30000);
    await vscode.commands.executeCommand("dataverse-powertools.clearQueryMetadataCache");
  });
});

/** Poll a condition for up to ~5s — provider results arrive asynchronously. */
async function waitFor<T>(check: () => T | undefined, attempts = 50): Promise<T | undefined> {
  for (let i = 0; i < attempts; i++) {
    const result = check();
    if (result !== undefined) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}
