import * as vscode from "vscode";
import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes } from "../context";
import { createServicePrincipalString, updateConnectionString } from "./connectionStringManager";
import { initialiseProject } from "./generateTemplates";
import { restoreDependencies } from "./restoreDependencies";
import { DataverseContext } from "./dataverse/dataverseContext";

export async function generalInitialise(context: DataversePowerToolsContext) {
  await context.readSettings(context);
  if (context.projectSettings?.connectionString === undefined || context.projectSettings?.connectionString === "" || context.projectSettings?.connectionString === null) {
    vscode.commands.executeCommand("setContext", "dataverse-powertools.showLoaded", false);
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.initialiseProject", () => initialiseProject(context)));
  } else {
    context.dataverse = new DataverseContext(context);
    await context.dataverse.initialize();
    vscode.commands.executeCommand("setContext", "dataverse-powertools.showLoaded", true);
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createConnectionString", () => createServicePrincipalString(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.restoreDependencies", () => restoreDependencies(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.updateConnectionString", () => updateConnectionString(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.openSettings", () => context.openSettings()));
  }
}
