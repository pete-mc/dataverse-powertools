import * as vscode from "vscode";
import DataversePowerToolsContext, { PowertoolsTemplate } from "../context";
import { isSupportedProjectType } from "../projectTypes/registry";
import { discoverWorkspaceComponents } from "../components/componentDiscovery";
import { addComponent, convertToComponentsWorkspace } from "../components/addComponent";
import { createServicePrincipalString, updateConnectionString, switchEnvironment, refreshConnection, clearPacCredentials } from "./connectionStringManager";
import { openEnvironment, openAdminCenter, openMakerPortal } from "./openPortals";
import { createNewProject } from "./generateTemplates";
import { restoreDependencies } from "./restoreDependencies";
import { setTraceLogLevel } from "./setTraceLogLevel";
import { DataverseContext } from "./dataverse/dataverseContext";
import { scanSystemRequirements } from "./systemRequirements";

/**
 * Register the workspace-level / connection commands ONCE, at activation — the same register-once
 * pattern the rest of the extension uses (`registerAllComponentCommands`, LM tools, portals,
 * CodeLens). Handlers resolve their target off the long-lived `context` singleton at INVOKE time,
 * whose settings/components/dataverse are refreshed by `generalInitialise` on every workspace load.
 *
 * These previously registered inside `generalInitialise`, which runs once per workspace load (and
 * again from `createNewProject`). That made registration non-idempotent: a second load in the same
 * extension host threw "command … already exists", which aborted activation and cascaded into
 * "command 'dataverse-powertools.restoreDependencies' not found" when a panel button later fired it.
 * Registering once here removes that class of failure — command availability no longer depends on
 * how many times a workspace has been (re-)initialised. Menu/palette VISIBILITY is still gated by
 * the `when`-clause context keys (`showLoaded`, etc.) that `generalInitialise` sets.
 */
export function registerGlobalCommands(context: DataversePowerToolsContext) {
  const register = (id: string, handler: () => unknown) => context.vscode.subscriptions.push(vscode.commands.registerCommand(id, handler));
  register("dataverse-powertools.initialiseProject", () => createNewProject(context));
  register("dataverse-powertools.createConnectionString", () => createServicePrincipalString(context));
  register("dataverse-powertools.restoreDependencies", () => restoreDependencies(context));
  register("dataverse-powertools.updateConnectionString", () => updateConnectionString(context));
  register("dataverse-powertools.switchEnvironment", () => switchEnvironment(context));
  register("dataverse-powertools.refreshConnection", () => refreshConnection(context));
  register("dataverse-powertools.setTraceLogLevel", () => setTraceLogLevel(context));
  register("dataverse-powertools.clearPacCredentials", () => clearPacCredentials(context));
  register("dataverse-powertools.openEnvironment", () => openEnvironment(context));
  register("dataverse-powertools.openAdminCenter", () => openAdminCenter(context));
  register("dataverse-powertools.openMakerPortal", () => openMakerPortal(context));
  register("dataverse-powertools.openSettings", () => context.openSettings());
  register("dataverse-powertools.addComponent", () => addComponent(context));
  register("dataverse-powertools.convertToComponentsWorkspace", () => convertToComponentsWorkspace(context));
}

export async function generalInitialise(context: DataversePowerToolsContext) {
  await scanSystemRequirements(context);
  await context.readSettings();
  // Discover every component in the workspace (#47) — a single project is just
  // the root component; commands resolve their target component at invocation.
  await discoverWorkspaceComponents(context);
  const hasSupportedComponent = context.components.some((c) => isSupportedProjectType(c.settings.type)) || isSupportedProjectType(context.projectSettings?.type);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasSupportedProjectType", hasSupportedComponent);

  // Commands are registered ONCE at activation (registerGlobalCommands); here we only refresh the
  // connection state + the context keys that gate their menu/panel visibility. This runs on every
  // workspace (re-)load, so it must stay idempotent — never registerCommand from here.
  const hasConnection = !(
    context.projectSettings?.connectionString === undefined ||
    context.projectSettings?.connectionString === "" ||
    context.projectSettings?.connectionString === null
  );
  if (!hasConnection) {
    await vscode.commands.executeCommand("setContext", "dataverse-powertools.showLoaded", false);
  } else {
    context.dataverse = new DataverseContext(context);
    // Connect silently on load (from the cached token); don't pop a browser on startup.
    await context.dataverse.initialize(false);
    await vscode.commands.executeCommand("setContext", "dataverse-powertools.showLoaded", true);
  }

  await vscode.commands.executeCommand("setContext", "dataverse-powertools.detectingFolderSettings", false);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.folderStateReady", true);
  context.folderStateReady = true;
  context.refreshPanel?.();
}
