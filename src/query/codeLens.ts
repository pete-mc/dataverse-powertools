// CodeLens and diagnostics on FetchXML found in code (#238).
//
// This is the discovery surface: the lens appears on the query the developer already has, which is
// why the feature needs no new file type and works on day one against an existing codebase. The
// diagnostics are worth having even if nobody ever opens the generator.
//
// Registered ONCE globally (in extension.ts), never in a per-component `initialise*` — a second
// component of the same type would throw on a duplicate registration (#47).

import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { previewFeaturesEnabled } from "../general/extensionConfig";
import { DetectedQuery, detectQueries } from "./detect";
import { diagnoseQuery, QueryDiagnostic } from "./diagnostics";
import { allTokenNames } from "./holes";
import { languageFor } from "./literals";
import { getMetadataCache } from "./metadataService";
import { collectParameters } from "./parameters";
import { serializeFetchXml, DEFAULT_FORMAT } from "./fetchXml";

export const OPEN_GENERATOR_COMMAND = "dataverse-powertools.openFetchXmlGenerator";
export const RUN_QUERY_COMMAND = "dataverse-powertools.runFetchXml";

const DIAGNOSTIC_SOURCE = "Dataverse PowerTools";

/** Languages we scan. Kept in step with `languageFor`. */
const QUERY_LANGUAGES = ["csharp", "typescript", "typescriptreact", "javascript", "javascriptreact"];

/**
 * Documents we scan. `untitled` is included deliberately: pasting a query into a scratch buffer to
 * run it is one of the main things this feature replaces a separate tool for. Other schemes (diff
 * views, output channels) are left out so lenses don't appear where they can't be acted on.
 */
export const QUERY_DOCUMENT_SELECTOR: vscode.DocumentSelector = QUERY_LANGUAGES.flatMap((language) => [
  { language, scheme: "file" },
  { language, scheme: "untitled" },
]);

/** Find every query in a document, or nothing when the language isn't one we scan. */
export function queriesIn(document: vscode.TextDocument): DetectedQuery[] {
  const language = languageFor(document.languageId);
  if (!language) {
    return [];
  }
  return detectQueries(document.getText(), language);
}

function diagnosticsFor(context: DataversePowerToolsContext, query: DetectedQuery): QueryDiagnostic[] {
  const expressions = Object.fromEntries(query.tokens.map((token) => [token.name, token.expression]));
  const xml = serializeFetchXml(query.root, DEFAULT_FORMAT);
  return diagnoseQuery({
    root: query.root,
    consumer: query.consumer,
    language: query.language,
    parameters: collectParameters(query.root, allTokenNames(xml), expressions),
    // Whatever metadata happens to be loaded. Nothing is fetched here: a CodeLens pass must not
    // make network calls, so name checks appear once the generator has warmed the cache.
    metadata: getMetadataCache(context),
  });
}

const SEVERITY: Record<QueryDiagnostic["severity"], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export class FetchXmlCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private readonly context: DataversePowerToolsContext) {}

  refresh(): void {
    this.changed.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    // The whole feature is preview-gated, so with the flag off the lens simply never appears.
    if (!previewFeaturesEnabled()) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    for (const query of queriesIn(document)) {
      const range = new vscode.Range(document.positionAt(query.start), document.positionAt(query.start));
      const problems = diagnosticsFor(this.context, query).filter((diagnostic) => diagnostic.severity !== "info");

      lenses.push(
        new vscode.CodeLens(range, {
          title: "▶ Run",
          tooltip: "Run this FetchXML against the connected environment",
          command: RUN_QUERY_COMMAND,
          arguments: [document.uri, query.start],
        }),
      );
      lenses.push(
        new vscode.CodeLens(range, {
          title: query.writable ? "✎ Edit in generator" : "👁 View in generator",
          tooltip: query.writable ? "Open the FetchXML Generator on this query" : "This string can't be rewritten safely, so the generator opens read-only",
          command: OPEN_GENERATOR_COMMAND,
          arguments: [document.uri, query.start],
        }),
      );
      if (problems.length > 0) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `⚠ ${problems.length} ${problems.length === 1 ? "issue" : "issues"}`,
            tooltip: problems.map((problem) => problem.message).join("\n"),
            command: "workbench.actions.view.problems",
            arguments: [],
          }),
        );
      }
    }
    return lenses;
  }
}

/** Publish the diagnostics for one document. */
export function refreshDiagnostics(context: DataversePowerToolsContext, collection: vscode.DiagnosticCollection, document: vscode.TextDocument): void {
  if (!previewFeaturesEnabled()) {
    collection.delete(document.uri);
    return;
  }
  const diagnostics: vscode.Diagnostic[] = [];
  for (const query of queriesIn(document)) {
    const range = new vscode.Range(document.positionAt(query.start), document.positionAt(query.end));
    for (const finding of diagnosticsFor(context, query)) {
      // Point an expression-specific finding at the expression itself, so the squiggle lands on the
      // interpolation rather than covering the whole query.
      const target = finding.expression ? locate(document, query, finding.expression) : undefined;
      const diagnostic = new vscode.Diagnostic(target ?? range, finding.message, SEVERITY[finding.severity]);
      diagnostic.source = DIAGNOSTIC_SOURCE;
      diagnostic.code = finding.code;
      diagnostics.push(diagnostic);
    }
  }
  collection.set(document.uri, diagnostics);
}

/** Find an expression inside the query's span so a diagnostic can point at it precisely. */
function locate(document: vscode.TextDocument, query: Pick<DetectedQuery, "start" | "end">, expression: string): vscode.Range | undefined {
  const span = document.getText().slice(query.start, query.end);
  const index = span.indexOf(expression);
  if (index === -1) {
    return undefined;
  }
  return new vscode.Range(document.positionAt(query.start + index), document.positionAt(query.start + index + expression.length));
}

/** Quick fixes for the findings that have one — currently the unescaped-value warning. */
export class FetchXmlCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range | vscode.Selection, actionContext: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of actionContext.diagnostics) {
      if (diagnostic.source !== DIAGNOSTIC_SOURCE || diagnostic.code !== "unescapedValue") {
        continue;
      }
      const expression = document.getText(diagnostic.range);
      const wrapper = document.languageId === "csharp" ? `SecurityElement.Escape(${expression})` : `escapeXml(${expression})`;
      const action = new vscode.CodeAction(`Escape with ${document.languageId === "csharp" ? "SecurityElement.Escape" : "escapeXml"}`, vscode.CodeActionKind.QuickFix);
      action.edit = new vscode.WorkspaceEdit();
      action.edit.replace(document.uri, diagnostic.range, wrapper);
      action.diagnostics = [diagnostic];
      actions.push(action);
      if (document.languageId === "csharp") {
        action.isPreferred = true;
      }
    }
    return actions;
  }
}
