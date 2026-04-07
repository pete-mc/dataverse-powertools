import DataversePowerToolsContext from "../context";
import * as vscode from "vscode";
import { configureModelBuilderSettings, generateEarlyBoundV3, loadPluginModelBuilderSettings, updatePluginModelBuilderSettingsContext } from "../general/modelbuilder";

function registerPlaceholderCommand(context: DataversePowerToolsContext, commandId: string, message: string) {
  context.vscode.subscriptions.push(
    vscode.commands.registerCommand(commandId, () => {
      context.channel.appendLine(`[Plugin Placeholder] ${message}`);
      vscode.window.showInformationMessage(message);
    }),
  );
}

export async function initialisePlugins(context: DataversePowerToolsContext): Promise<void> {
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPlugin", true);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPluginV3", true);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isWebResource", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isSolution", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPortal", false);
  await loadPluginModelBuilderSettings(context);
  void updatePluginModelBuilderSettingsContext(context);

  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generateEarlyBound", () => generateEarlyBoundV3(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.configurePluginEarlyBound", () => configureModelBuilderSettings(context)));
  registerPlaceholderCommand(context, "dataverse-powertools.buildDeployPlugin", "Plugin build/deploy flow is coming soon.");
  registerPlaceholderCommand(context, "dataverse-powertools.buildProject", "Plugin build project flow is coming soon.");
  registerPlaceholderCommand(context, "dataverse-powertools.buildDeployWorkflow", "Plugin workflow deploy flow is coming soon.");
  registerPlaceholderCommand(context, "dataverse-powertools.createPluginClass", "Plugin class scaffolding is coming soon.");
  registerPlaceholderCommand(context, "dataverse-powertools.createWorkflowClass", "Plugin workflow class scaffolding is coming soon.");
  registerPlaceholderCommand(context, "dataverse-powertools.createSNKKey", "This template uses pac plugin init --skip-signing; SNK generation is not required by default.");
  registerPlaceholderCommand(context, "dataverse-powertools.addPluginDecoration", "Plugin decoration tooling is coming soon.");
  registerPlaceholderCommand(context, "dataverse-powertools.addWorkflowDecoration", "Workflow decoration tooling is coming soon.");
}
