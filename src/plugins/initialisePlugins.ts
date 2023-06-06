import DataversePowerToolsContext from "../context";
import * as vscode from "vscode";
import { addPluginDecoration } from "./addStepDecoration";
import { addWorkflowDecoration } from "./addWorkflowDecoration";
import { buildDeployPlugin } from "./buildDeployPlugin";
import { buildDeployWorkflow } from "./buildDeployWorkflow";
import { buildProject } from "./buildPlugin";
import { createPluginClass, createWorkflowClass } from "./createPluginClass";
import { generateEarlyBound, createSNKKey } from "./earlybound";

export function initialisePlugins(context: DataversePowerToolsContext): void {
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPlugin", true);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isWebResource", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isSolution", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPortal", false);
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generateEarlyBound", () => generateEarlyBound(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildDeployPlugin", () => buildDeployPlugin(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildProject", () => buildProject(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildDeployWorkflow", () => buildDeployWorkflow(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createPluginClass", () => createPluginClass(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createWorkflowClass", () => createWorkflowClass(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createSNKKey", () => createSNKKey(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.addPluginDecoration", () => addPluginDecoration(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.addWorkflowDecoration", () => addWorkflowDecoration(context)));
}
