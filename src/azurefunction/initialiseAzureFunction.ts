import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";

// Per-type setup for Azure Function (Dataverse webhook handler) components: just the context
// key that gates the Azure Function UI in package.json. Commands register ONCE globally in
// projectTypes/activation.ts (#47) — never here, or a second Azure Function component's
// initialise re-registers and VS Code throws "command … already exists".
//
// No global singletons and no TestController: this runs once PER COMPONENT.
export async function initialiseAzureFunction(context: DataversePowerToolsContext): Promise<void> {
  void context;
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.isAzureFunction", true);
}
