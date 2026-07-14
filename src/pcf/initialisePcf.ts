import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";

// Per-type setup for PCF control components: just the context key that gates the
// PCF UI in package.json. Commands register ONCE globally in
// projectTypes/activation.ts (#47) — never here, or a second PCF component's
// initialise re-registers and VS Code throws "command … already exists".
//
// No global singletons and no TestController in v1 (Jest Test Explorer wiring is
// an explicit fast-follow, #141).
export async function initialisePcf(context: DataversePowerToolsContext): Promise<void> {
  void context;
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.isPcf", true);
}
