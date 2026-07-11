import DataversePowerToolsContext from "../context";
import * as vscode from "vscode";

// Per-type setup for legacy (template < 3) plugin projects — deprecated, kept
// for existing workspaces. Commands register once globally in
// projectTypes/activation.ts (#47), which routes plugin commands to the legacy
// implementations when templateversion < 3 — never register commands here.
export function initialisePlugins(context: DataversePowerToolsContext): void {
  void context;
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPlugin", true);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPluginV3", false);
}
