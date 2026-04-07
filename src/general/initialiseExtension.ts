import * as vscode from "vscode";
import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes } from "../context";
import { createServicePrincipalString, updateConnectionString } from "./connectionStringManager";
import { createNewProject } from "./generateTemplates";
import { restoreDependencies } from "./restoreDependencies";
import { DataverseContext } from "./dataverse/dataverseContext";
import { scanSystemRequirements } from "./systemRequirements";

export async function generalInitialise(context: DataversePowerToolsContext) {
  await scanSystemRequirements(context);
  await context.readSettings();
  const hasSupportedProjectType =
    context.projectSettings?.type === ProjectTypes.webresource ||
    context.projectSettings?.type === ProjectTypes.plugin ||
    context.projectSettings?.type === ProjectTypes.solution ||
    context.projectSettings?.type === ProjectTypes.portal;

  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasSupportedProjectType", hasSupportedProjectType);

  if (context.projectSettings?.connectionString === undefined || context.projectSettings?.connectionString === "" || context.projectSettings?.connectionString === null) {
    await vscode.commands.executeCommand("setContext", "dataverse-powertools.showLoaded", false);
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.initialiseProject", () => createNewProject(context)));
  } else {
    context.dataverse = new DataverseContext(context);
    await context.dataverse.initialize();
    await vscode.commands.executeCommand("setContext", "dataverse-powertools.showLoaded", true);
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createConnectionString", () => createServicePrincipalString(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.restoreDependencies", () => restoreDependencies(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.updateConnectionString", () => updateConnectionString(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.openSettings", () => context.openSettings()));
  }

  await vscode.commands.executeCommand("setContext", "dataverse-powertools.detectingFolderSettings", false);
}
