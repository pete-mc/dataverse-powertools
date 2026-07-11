import DataversePowerToolsContext from "../context";
import * as vscode from "vscode";

// Per-type setup for portal components. Commands register once globally in
// projectTypes/activation.ts (#47) — never here.
export function initialisePortals(context: DataversePowerToolsContext): void {
  void context;
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPortal", true);
}
