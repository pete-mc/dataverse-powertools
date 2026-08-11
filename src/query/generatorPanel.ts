// The FetchXML Generator webview (#238).
//
// The host owns the model. The webview posts INTENTS (select a node, set a field, add a child) and
// this file applies them with the pure functions in edits.ts, recomputes the view-model in
// generatorState.ts, and posts fresh state back. That is what keeps the webview a renderer and the
// generator's behaviour unit-testable.
//
// Saving goes through computeWriteBack, which refuses anything it cannot re-read identically, and
// applies the change as a single WorkspaceEdit so it is one undo step.

import * as path from "path";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { GeneratorState, ParameterRow, buildState, defaultsFor, scopeEntity } from "./generatorState";
import { DetectedQuery, detectQueries } from "./detect";
import { QueryEdit, applyEdit, newQuery } from "./edits";
import { DEFAULT_FORMAT, XmlFormat, detectFormat, parseFetchXml, serializeFetchXml } from "./fetchXml";
import { allTokenNames } from "./holes";
import { languageFor } from "./literals";
import { getMetadataCache } from "./metadataService";
import { QueryParameter, collectParameters, inferParameterType, normalizeParameterValue, substituteParameters, validateParameterValue } from "./parameters";
import { QueryNode, cloneNode, nodesEqual, walk } from "./queryModel";
import { diagnoseQuery } from "./diagnostics";
import { runFetchXml } from "./runQuery";
import { showResults, showResultsError } from "./resultsPanel";
import { computeWriteBack } from "./writeBack";
import { UNKNOWN_CONSUMER } from "./consumers";

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

/** Everything the open generator is working on. */
interface Session {
  panel: vscode.WebviewPanel;
  /** The document the query came from, absent when building a brand-new query. */
  document?: vscode.TextDocument;
  /** Re-detected against the live document each time we save, so a shifted span is still correct. */
  query?: DetectedQuery;
  root: QueryNode;
  original: QueryNode;
  format: XmlFormat;
  selection: number[];
  /** Prompted parameter values, remembered for the session. */
  values: Record<string, string>;
  title: string;
}

let session: Session | undefined;

/** Open the generator on a detected query, or with a fresh one when `query` is undefined. */
export async function openGenerator(context: DataversePowerToolsContext, document: vscode.TextDocument | undefined, query: DetectedQuery | undefined): Promise<void> {
  const parsed = query ? parseFetchXml(query.xml) : undefined;
  const root = parsed?.ok ? parsed.root : newQuery();
  const format = parsed?.ok ? parsed.format : DEFAULT_FORMAT;
  const title = document ? `${document.fileName.split(/[\\/]/).pop()}` : "New query";

  const panel =
    session?.panel ??
    vscode.window.createWebviewPanel("dataversePowerToolsQueryGenerator", "FetchXML Generator", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.vscode.extensionUri, "media")],
    });

  const isNew = session?.panel !== panel;
  session = { panel, document, query, root, original: cloneNode(root), format, selection: [], values: session?.values ?? {}, title };

  if (isNew) {
    panel.onDidDispose(() => {
      session = undefined;
    });
    panel.webview.onDidReceiveMessage((message) => void onMessage(context, message));
    panel.webview.html = html(panel.webview, context);
  }

  panel.title = `FetchXML Generator — ${title}`;
  panel.reveal(vscode.ViewColumn.Active);
  post(context);
  // FINAL signal for this command: everything the generator needs is rendered. The e2e suite gates on
  // this line rather than on the panel appearing, so a step can't start while the previous one runs.
  let elements = 0;
  walk(root, () => {
    elements++;
  });
  context.channel.appendLine(
    `[Query] Generator ready for ${title} — ${query?.consumer.label ?? "FetchXML"}, ${elements} elements${query?.writable === false ? ", read-only" : ""}`,
  );
  // Warm the table list in the background; the picker fills in when it lands.
  void warmMetadata(context);
}

async function warmMetadata(context: DataversePowerToolsContext): Promise<void> {
  const cache = getMetadataCache(context);
  try {
    // Log only on the fetch, not on every cache hit — this runs on each selection change.
    const hadTables = cache.loadedTables() !== undefined;
    const tables = await cache.getTables();
    if (!hadTables) {
      context.channel.appendLine(`[Query] Metadata ready: ${tables.length} tables`);
    }
    const entity = session ? scopeEntity(session.root, session.selection) : undefined;
    if (entity && !entity.startsWith("@")) {
      const hadColumns = cache.loadedAttributes(entity) !== undefined;
      const columns = await cache.getAttributes(entity);
      if (!hadColumns) {
        context.channel.appendLine(`[Query] Metadata ready: ${columns.length} columns on ${entity}`);
      }
    }
  } catch (error) {
    context.channel.appendLine(`[Query] Could not load metadata: ${(error as Error).message}`);
  }
  post(context);
}

/** The query's parameters, resolved once and reused for both the prompt rows and the diagnostics. */
function currentParameters(current: Session): QueryParameter[] {
  const xml = serializeFetchXml(current.root, current.format);
  const expressions = Object.fromEntries((current.query?.tokens ?? []).map((token) => [token.name, token.expression]));
  return collectParameters(current.root, allTokenNames(xml), expressions);
}

function parameterRows(context: DataversePowerToolsContext, current: Session, parameters: readonly QueryParameter[]): ParameterRow[] {
  const metadata = getMetadataCache(context);
  return parameters.map((parameter) => ({
    name: parameter.name,
    type: inferParameterType(parameter, metadata),
    expression: parameter.expression,
    value: current.values[parameter.name] ?? "",
  }));
}

function currentState(context: DataversePowerToolsContext, current: Session): GeneratorState {
  const metadata = getMetadataCache(context);
  const parameters = currentParameters(current);
  const entity = scopeEntity(current.root, current.selection);
  const attributes = entity && !entity.startsWith("@") ? metadata.loadedAttributes(entity) : undefined;

  return buildState({
    root: current.root,
    format: current.format,
    selection: current.selection,
    diagnostics: diagnoseQuery({
      root: current.root,
      consumer: current.query?.consumer ?? UNKNOWN_CONSUMER,
      language: current.query?.language ?? "csharp",
      parameters,
      metadata,
    }),
    parameters: parameterRows(context, current, parameters),
    tables: metadata.loadedTables()?.map((table) => ({ logicalName: table.logicalName, displayName: table.displayName })),
    attributes: attributes?.map((attribute) => ({ logicalName: attribute.logicalName, displayName: attribute.displayName })),
    readOnly: current.query !== undefined && !current.query.writable,
    consumerLabel: current.query?.consumer.label ?? "FetchXML",
    title: current.title,
    dirty: !nodesEqual(current.root, current.original),
  });
}

function post(context: DataversePowerToolsContext): void {
  if (!session) {
    return;
  }
  void session.panel.webview.postMessage({ type: "state", state: currentState(context, session) });
}

async function onMessage(context: DataversePowerToolsContext, message: Record<string, unknown>): Promise<void> {
  const current = session;
  if (!current) {
    return;
  }

  switch (message.type) {
    case "ready":
      post(context);
      return;

    case "select": {
      current.selection = asPath(message.path);
      post(context);
      void warmMetadata(context);
      return;
    }

    case "edit": {
      const edit = asEdit(message.edit);
      if (!edit) {
        return;
      }
      const applied = applyEdit(current.root, edit);
      if (!applied) {
        return;
      }
      current.root = applied.root;
      current.selection = applied.selection;
      post(context);
      if (edit.kind === "setAttr" && edit.name === "name") {
        void warmMetadata(context);
      }
      return;
    }

    case "add": {
      const tag = typeof message.tag === "string" ? message.tag : undefined;
      if (!tag) {
        return;
      }
      const applied = applyEdit(current.root, { kind: "addChild", path: asPath(message.path), tag, attrs: defaultsFor(tag) });
      if (applied) {
        current.root = applied.root;
        current.selection = applied.selection;
        post(context);
      }
      return;
    }

    case "setXml": {
      // The XML pane is editable: parse it, and keep the text if it doesn't parse so the user can fix it.
      const xml = typeof message.xml === "string" ? message.xml : "";
      const parsed = parseFetchXml(xml);
      if (!parsed.ok) {
        void current.panel.webview.postMessage({ type: "xmlError", error: parsed.error });
        return;
      }
      current.root = parsed.root;
      current.format = detectFormat(xml);
      current.selection = [];
      post(context);
      return;
    }

    case "setParameter": {
      const name = typeof message.name === "string" ? message.name : undefined;
      if (name) {
        current.values[name] = typeof message.value === "string" ? message.value : "";
      }
      return;
    }

    case "run":
      await runCurrent(context, current);
      return;

    case "save":
      await saveCurrent(context, current);
      return;

    case "copyXml":
      await vscode.env.clipboard.writeText(serializeFetchXml(current.root, current.format));
      vscode.window.showInformationMessage("FetchXML copied.");
      return;

    case "refreshMetadata": {
      getMetadataCache(context).clear();
      await warmMetadata(context);
      vscode.window.showInformationMessage("Metadata reloaded from the environment.");
      return;
    }
  }
}

/** Collect any missing parameter values, then run. */
async function runCurrent(context: DataversePowerToolsContext, current: Session): Promise<void> {
  const parameters = parameterRows(context, current, currentParameters(current));
  for (const parameter of parameters) {
    if (parameter.value.length > 0 && validateParameterValue(parameter.type, parameter.value) === undefined) {
      continue;
    }
    const entered = await vscode.window.showInputBox({
      title: "Run FetchXML",
      prompt: `${parameter.name}${parameter.expression ? ` (bound to ${parameter.expression})` : ""} — ${parameter.type}`,
      value: parameter.value,
      ignoreFocusOut: true,
      validateInput: (value) => validateParameterValue(parameter.type, value),
    });
    if (entered === undefined) {
      return; // cancelled
    }
    current.values[parameter.name] = entered;
  }

  const values = Object.fromEntries(parameters.map((parameter) => [parameter.name, normalizeParameterValue(parameter.type, current.values[parameter.name] ?? "")]));
  const xml = substituteParameters(serializeFetchXml(current.root, current.format), values);

  const outcome = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Running FetchXML…" }, () => runFetchXml(context, xml));
  if (outcome.ok) {
    showResults(context, { table: outcome.table, context: outcome.context, xml, title: current.title });
  } else {
    showResultsError(context, current.title, outcome.error);
  }
}

/** Write the edited query back into the source file. */
async function saveCurrent(context: DataversePowerToolsContext, current: Session): Promise<void> {
  if (!current.document || !current.query) {
    vscode.window.showInformationMessage("This query isn't attached to a file. Use “Insert at cursor” from the palette instead.");
    return;
  }

  // Re-detect against the CURRENT document text: the user may have edited the file since the generator
  // opened, which would have shifted the span we captured.
  const language = languageFor(current.document.languageId);
  const fresh = language ? detectQueries(current.document.getText(), language) : [];
  const target = fresh.find((candidate) => candidate.start === current.query?.start) ?? fresh.find((candidate) => candidate.xml === current.query?.xml);
  if (!target) {
    vscode.window.showWarningMessage("The original query is no longer where it was in the file — save it manually with Copy FetchXML.");
    return;
  }

  const result = computeWriteBack(target, serializeFetchXml(current.root, current.format));
  if (!result.ok) {
    vscode.window.showErrorMessage(result.reason);
    return;
  }
  if (!result.changed) {
    vscode.window.showInformationMessage("No changes to write.");
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(current.document.uri, new vscode.Range(current.document.positionAt(target.start), current.document.positionAt(target.end)), result.text);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    vscode.window.showErrorMessage("Could not apply the edit to the file.");
    return;
  }

  // Then PERSIST it. `applyEdit` only changes the in-memory document, which would leave the button
  // labelled "Save to code" having saved nothing — the file on disk (the one that compiles and
  // deploys) would still hold the old query, and the user wouldn't necessarily notice the dirty
  // marker. The edit stays a single undo step either way. Any other unsaved changes in this document
  // are written too, which is why the notification names the file.
  const saved = await current.document.save();
  if (!saved) {
    vscode.window.showWarningMessage(`The query was updated in the editor but ${path.basename(current.document.fileName)} could not be saved — save it yourself.`);
  }

  current.original = cloneNode(current.root);
  current.query = detectQueries(current.document.getText(), language ?? "csharp").find((candidate) => candidate.start === target.start);
  context.channel.appendLine(`[Query] Wrote the edited query back to ${current.document.fileName}${saved ? " (saved)" : " (UNSAVED — save it yourself)"}`);
  if (saved) {
    vscode.window.showInformationMessage(`Updated the FetchXML in ${path.basename(current.document.fileName)}.`);
  }
  post(context);
}

function asPath(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number" && entry >= 0) : [];
}

/** Validate an edit intent from the webview — it is our own code, but treat it as untrusted. */
function asEdit(value: unknown): QueryEdit | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const path = asPath(candidate.path);
  switch (candidate.kind) {
    case "setAttr":
      return typeof candidate.name === "string"
        ? { kind: "setAttr", path, name: candidate.name, value: typeof candidate.value === "string" ? candidate.value : undefined }
        : undefined;
    case "addChild":
      return typeof candidate.tag === "string" ? { kind: "addChild", path, tag: candidate.tag, attrs: defaultsFor(candidate.tag) } : undefined;
    case "remove":
      return { kind: "remove", path };
    case "setText":
      return typeof candidate.text === "string" ? { kind: "setText", path, text: candidate.text } : undefined;
    case "move":
      return typeof candidate.offset === "number" ? { kind: "move", path, offset: candidate.offset } : undefined;
    default:
      return undefined;
  }
}

function html(webview: vscode.Webview, context: DataversePowerToolsContext): string {
  const token = nonce();
  const css = webview.asWebviewUri(vscode.Uri.joinPath(context.vscode.extensionUri, "media", "queryGenerator.css"));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(context.vscode.extensionUri, "media", "queryGenerator.js"));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${token}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${css}" rel="stylesheet">
  <title>FetchXML Generator</title>
</head>
<body>
  <header>
    <div id="title"></div>
    <div id="actions">
      <button id="run" type="button">▶ Run</button>
      <button id="save" type="button">Save to code</button>
      <button id="copy" type="button">Copy FetchXML</button>
      <button id="refresh" type="button" title="Reload tables and columns from the environment">Reload metadata</button>
    </div>
  </header>
  <div id="notice" hidden></div>
  <main>
    <section id="treePane" aria-label="Query structure">
      <div id="tree" role="tree"></div>
      <div id="treeActions"></div>
    </section>
    <section id="propertiesPane" aria-label="Properties">
      <div id="properties"></div>
      <div id="otherAttributes"></div>
      <div id="parameters"></div>
      <div id="diagnostics"></div>
    </section>
  </main>
  <section id="xmlPane">
    <label for="xml">FetchXML</label>
    <textarea id="xml" spellcheck="false" rows="10"></textarea>
    <div id="xmlError" role="alert" hidden></div>
  </section>
  <script nonce="${token}" src="${js}"></script>
</body>
</html>`;
}
