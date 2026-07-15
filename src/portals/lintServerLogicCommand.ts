// Command: lint the active editor as Power Pages Server Logic (#150 #2). Surfaces
// the pure lint (serverLogicLint.ts) as inline diagnostics + an output summary, so
// blocked patterns are caught before `pac powerpages upload` rejects them. Registered
// once, globally (not per-component). Pure logic lives in serverLogicLint.ts.

import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { lintServerLogic, serverLogicPasses } from "./serverLogicLint";

let diagnostics: vscode.DiagnosticCollection | undefined;

export function registerServerLogicLint(context: DataversePowerToolsContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection("dvpt-server-logic");
  context.vscode.subscriptions.push(diagnostics);
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.lintServerLogic", () => lintActiveEditor(context)));
}

function lintActiveEditor(context: DataversePowerToolsContext): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("Open the Server Logic script you want to lint.");
    return;
  }

  const doc = editor.document;
  const findings = lintServerLogic(doc.getText());

  const diags = findings.map((f) => {
    const lineText = doc.lineAt(Math.min(f.line - 1, doc.lineCount - 1));
    const diag = new vscode.Diagnostic(
      lineText.range,
      `${f.message} (Server Logic ${f.severity === "blocked" ? "blocked pattern" : "unsupported API"}: ${f.pattern})`,
      f.severity === "blocked" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
    );
    diag.source = "Dataverse PowerTools · Server Logic";
    return diag;
  });
  diagnostics?.set(doc.uri, diags);

  const blocked = findings.filter((f) => f.severity === "blocked").length;
  const unsupported = findings.length - blocked;
  if (findings.length === 0) {
    vscode.window.showInformationMessage("Server Logic lint: no blocked or unsupported patterns found. ✅");
  } else {
    context.channel.appendLine(`\nServer Logic lint — ${blocked} blocked, ${unsupported} unsupported:`);
    findings.forEach((f) => context.channel.appendLine(`  line ${f.line} [${f.severity}] ${f.pattern}: ${f.message}`));
    context.channel.show(true);
    const verdict = serverLogicPasses(findings) ? "would upload, but has unsupported browser APIs" : "would be REJECTED on upload";
    vscode.window.showWarningMessage(`Server Logic lint: ${blocked} blocked, ${unsupported} unsupported — ${verdict}. See the editor + output.`);
  }
}
