import DataversePowerToolsContext from "../context";
import * as vscode from "vscode";
import { configureModelBuilderSettings, generateEarlyBoundV3, loadPluginModelBuilderSettings, updatePluginModelBuilderSettingsContext } from "../general/modelbuilder";
import { buildProject } from "./buildProject";
import { createPluginClass, createWorkflowClass } from "./createClasses";
import { addClassDecoration, updateFilteringAttributes } from "./decorations";

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
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildProject", () => buildProject(context)));
  registerPlaceholderCommand(context, "dataverse-powertools.buildDeployWorkflow", "Plugin workflow deploy flow is coming soon.");
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createPluginClass", () => createPluginClass(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createWorkflowClass", () => createWorkflowClass(context)));
  registerPlaceholderCommand(context, "dataverse-powertools.createSNKKey", "This template uses pac plugin init --skip-signing; SNK generation is not required by default.");
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.addClassDecoration", () => addClassDecoration(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.addPluginDecoration", () => addClassDecoration(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.addWorkflowDecoration", () => addClassDecoration(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.updateFilteringAttributes", () => updateFilteringAttributes(context)));
}
