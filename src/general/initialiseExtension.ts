import * as vscode from "vscode";
import DataversePowerToolsContext, { PowertoolsTemplate } from "../context";
import { isSupportedProjectType } from "../projectTypes/registry";
import { discoverWorkspaceComponents } from "../components/componentDiscovery";
import { addComponent, convertToComponentsWorkspace } from "../components/addComponent";
import { createServicePrincipalString, updateConnectionString, switchEnvironment, refreshConnection, clearPacCredentials } from "./connectionStringManager";
import { openEnvironment, openAdminCenter, openMakerPortal } from "./openPortals";
import { createNewProject } from "./generateTemplates";
import { restoreDependencies } from "./restoreDependencies";
import { DataverseContext } from "./dataverse/dataverseContext";
import { scanSystemRequirements } from "./systemRequirements";

export async function generalInitialise(context: DataversePowerToolsContext) {
  await scanSystemRequirements(context);
  await context.readSettings();
  // Discover every component in the workspace (#47) — a single project is just
  // the root component; commands resolve their target component at invocation.
  await discoverWorkspaceComponents(context);
  const hasSupportedComponent = context.components.some((c) => isSupportedProjectType(c.settings.type)) || isSupportedProjectType(context.projectSettings?.type);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasSupportedProjectType", hasSupportedComponent);

  if (context.projectSettings?.connectionString === undefined || context.projectSettings?.connectionString === "" || context.projectSettings?.connectionString === null) {
    await vscode.commands.executeCommand("setContext", "dataverse-powertools.showLoaded", false);
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.initialiseProject", () => createNewProject(context)));
  } else {
    context.dataverse = new DataverseContext(context);
    // Connect silently on load (from the cached token); don't pop a browser on startup.
    await context.dataverse.initialize(false);
    await vscode.commands.executeCommand("setContext", "dataverse-powertools.showLoaded", true);
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createConnectionString", () => createServicePrincipalString(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.restoreDependencies", () => restoreDependencies(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.updateConnectionString", () => updateConnectionString(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.switchEnvironment", () => switchEnvironment(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.refreshConnection", () => refreshConnection(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.clearPacCredentials", () => clearPacCredentials(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.openEnvironment", () => openEnvironment(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.openAdminCenter", () => openAdminCenter(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.openMakerPortal", () => openMakerPortal(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.openSettings", () => context.openSettings()));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.addComponent", () => addComponent(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.convertToComponentsWorkspace", () => convertToComponentsWorkspace(context)));
  }

  await vscode.commands.executeCommand("setContext", "dataverse-powertools.detectingFolderSettings", false);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.folderStateReady", true);
  context.folderStateReady = true;
  context.refreshPanel?.();
}
