import * as vscode from "vscode";
import * as cs from "./general/initialiseExtension";
import path = require("path");
import fs = require("fs");
import DataversePowerToolsContext from "./context";
import { getProjectTypeActivation } from "./projectTypes/activation";
import { registerMenuPanel } from "./panel/menuPanel";
import { registerSystemRequirementCommands } from "./general/systemRequirements";
import { initInteractiveTokenCache } from "./general/dataverse/tokenAcquisition";

export async function activate(vscodeContext: vscode.ExtensionContext) {
  const context = new DataversePowerToolsContext(vscodeContext);
  // Persist interactive sign-in tokens across restarts via VS Code secret storage.
  initInteractiveTokenCache(vscodeContext.secrets, context.channel);
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.showLog", () => context.channel.show(true)));
  // Register the actions panel first so it can render the "detecting" state
  // while settings load (#100).
  registerMenuPanel(context);
  registerSystemRequirementCommands(context);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.folderStateReady", false);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.detectingFolderSettings", true);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasSupportedProjectType", true);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.isPluginV3", false);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasPluginModelBuilderSettings", false);
  context.channel.appendLine(fs.readFileSync(context.vscode.asAbsolutePath(path.join("templates", "logo.txt")), "utf8"));
  context.channel.appendLine(`version: ${vscodeContext.extension.packageJSON.version}`);
  await initialise(context);
}

export async function initialise(context: DataversePowerToolsContext) {
  await cs.generalInitialise(context);
  await getProjectTypeActivation(context.projectSettings.type)?.initialise(context);
  context.refreshPanel?.();
}
