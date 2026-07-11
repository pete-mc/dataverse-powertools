import DataversePowerToolsContext from "../context";
import * as vscode from "vscode";

// Per-type setup for solution components. Commands register once globally in
// projectTypes/activation.ts (#47) — never here.
export function initialiseSolutions(context: DataversePowerToolsContext): void {
  void context;
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isSolution", true);
}
