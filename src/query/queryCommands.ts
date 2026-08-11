// Command registration for the FetchXML query tools (#238).
//
// Registered ONCE from extension.ts — never from a per-component `initialise*`, where a second
// component of the same type would throw "command already exists" (#47, shipped in 0.8.4).
//
// The three palette commands double as the CodeLens targets: called with (uri, offset) they act on
// that query, called with no arguments they act on the cursor.

import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { openGenerator } from "./generatorPanel";
import {
  FetchXmlCodeActionProvider,
  FetchXmlCodeLensProvider,
  OPEN_GENERATOR_COMMAND,
  QUERY_DOCUMENT_SELECTOR,
  RUN_QUERY_COMMAND,
  queriesIn,
  refreshDiagnostics,
} from "./codeLens";
import { DetectedQuery, queryAtOffset } from "./detect";
import { newQuery } from "./edits";
import { DEFAULT_FORMAT, serializeFetchXml } from "./fetchXml";
import { languageFor } from "./literals";
import { clearMetadataCaches, getMetadataCache } from "./metadataService";
import { collectParameters, inferParameterType, normalizeParameterValue, substituteParameters, validateParameterValue } from "./parameters";
import { allTokenNames } from "./holes";
import { runFetchXml } from "./runQuery";
import { showResults, showResultsError } from "./resultsPanel";
import { buildInsertion } from "./writeBack";

export const CLEAR_METADATA_COMMAND = "dataverse-powertools.clearQueryMetadataCache";

/** Resolve the query a command should act on: the one named by the lens, or the one at the cursor. */
async function resolveTarget(uri?: vscode.Uri, offset?: number): Promise<{ document: vscode.TextDocument; query: DetectedQuery } | undefined> {
  const document = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
  if (!document || !languageFor(document.languageId)) {
    return undefined;
  }
  const queries = queriesIn(document);
  if (queries.length === 0) {
    return undefined;
  }
  const position = offset ?? (vscode.window.activeTextEditor?.document === document ? document.offsetAt(vscode.window.activeTextEditor.selection.active) : 0);
  const query = queries.find((candidate) => candidate.start === offset) ?? queryAtOffset(queries, position);
  return query ? { document, query } : undefined;
}

/** Prompt for any parameter the query needs, then run it and show the results. */
async function runQuery(context: DataversePowerToolsContext, document: vscode.TextDocument, query: DetectedQuery): Promise<void> {
  const expressions = Object.fromEntries(query.tokens.map((token) => [token.name, token.expression]));
  const parameters = collectParameters(query.root, allTokenNames(query.xml), expressions);
  const metadata = getMetadataCache(context);
  const title = document.fileName.split(/[\\/]/).pop() ?? "query";

  const remembered = context.vscode.workspaceState;
  const values: Record<string, string> = {};
  for (const parameter of parameters) {
    const type = inferParameterType(parameter, metadata);
    // Remembered in workspaceState, never in the file: these are real record ids.
    const key = `dvpt.queryParam.${document.uri.toString()}.${parameter.name}`;
    const entered = await vscode.window.showInputBox({
      title: "Run FetchXML",
      prompt: `${parameter.name}${parameter.expression ? ` (bound to ${parameter.expression})` : ""} — ${type}`,
      value: remembered.get<string>(key) ?? "",
      ignoreFocusOut: true,
      validateInput: (value) => validateParameterValue(type, value),
    });
    if (entered === undefined) {
      return;
    }
    await remembered.update(key, entered);
    values[parameter.name] = normalizeParameterValue(type, entered);
  }

  const xml = substituteParameters(query.xml, values);
  const outcome = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Running FetchXML…" }, () => runFetchXml(context, xml));
  if (outcome.ok) {
    showResults(context, { table: outcome.table, context: outcome.context, xml, title });
  } else {
    showResultsError(context, title, outcome.error);
  }
}

/** Insert a starter query at the cursor, in the active file's language. */
async function insertNewQuery(context: DataversePowerToolsContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const language = editor ? languageFor(editor.document.languageId) : undefined;
  if (!editor || !language) {
    // No suitable editor: still useful — open the generator on a fresh query so it can be copied out.
    await openGenerator(context, undefined, undefined);
    return;
  }

  const xml = serializeFetchXml(newQuery(), DEFAULT_FORMAT);
  const line = editor.document.lineAt(editor.selection.active.line);
  const indent = /^[ \t]*/.exec(line.text)?.[0] ?? "";
  await editor.edit((generator) => generator.replace(editor.selection, buildInsertion(xml, language, indent)));

  // Then open the generator on what was just inserted, so the flow continues into the UI.
  const inserted = queriesIn(editor.document);
  const target = queryAtOffset(inserted, editor.document.offsetAt(editor.selection.active));
  await openGenerator(context, editor.document, target);
}

export function registerQueryCommands(context: DataversePowerToolsContext): void {
  const subscriptions = context.vscode.subscriptions;
  const lensProvider = new FetchXmlCodeLensProvider(context);
  const diagnostics = vscode.languages.createDiagnosticCollection("dataverse-powertools-fetchxml");

  subscriptions.push(
    diagnostics,
    vscode.languages.registerCodeLensProvider(QUERY_DOCUMENT_SELECTOR, lensProvider),
    vscode.languages.registerCodeActionsProvider(QUERY_DOCUMENT_SELECTOR, new FetchXmlCodeActionProvider(), {
      providedCodeActionKinds: FetchXmlCodeActionProvider.providedCodeActionKinds,
    }),

    vscode.commands.registerCommand(OPEN_GENERATOR_COMMAND, async (uri?: vscode.Uri, offset?: number) => {
      const target = await resolveTarget(uri, offset);
      if (!target) {
        // Nothing to edit where the cursor is: offer to start a new query instead of doing nothing.
        await insertNewQuery(context);
        return;
      }
      await openGenerator(context, target.document, target.query);
    }),

    vscode.commands.registerCommand(RUN_QUERY_COMMAND, async (uri?: vscode.Uri, offset?: number) => {
      const target = await resolveTarget(uri, offset);
      if (!target) {
        vscode.window.showInformationMessage("No FetchXML found at the cursor.");
        return;
      }
      await runQuery(context, target.document, target.query);
    }),

    vscode.commands.registerCommand(CLEAR_METADATA_COMMAND, async () => {
      clearMetadataCaches();
      context.channel.appendLine("[Query] Metadata cache cleared.");
      lensProvider.refresh();
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        refreshDiagnostics(context, diagnostics, editor.document);
      }
      vscode.window.showInformationMessage("Dataverse metadata cache cleared. It reloads on next use.");
    }),
  );

  // Diagnostics follow the open documents.
  const update = (document: vscode.TextDocument): void => {
    if (languageFor(document.languageId)) {
      refreshDiagnostics(context, diagnostics, document);
    }
  };
  subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(update),
    vscode.workspace.onDidChangeTextDocument((event) => update(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        update(editor.document);
      }
    }),
    // The whole feature is preview-gated, so flipping the flag has to add or remove the lenses and
    // squiggles immediately rather than at the next reload.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("dataverse-powertools.previewFeatures")) {
        lensProvider.refresh();
        vscode.workspace.textDocuments.forEach(update);
      }
    }),
  );
  vscode.workspace.textDocuments.forEach(update);

  context.channel.appendLine("[Query] FetchXML query tools registered.");
}
