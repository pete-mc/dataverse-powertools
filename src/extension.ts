import * as vscode from "vscode";
import * as cs from "./general/initialiseExtension";
import path = require("path");
import fs = require("fs");
import DataversePowerToolsContext from "./context";
import { getProjectTypeActivation, registerAllComponentCommands } from "./projectTypes/activation";
import { componentScopedContext } from "./components/componentDiscovery";
import { componentsOfType } from "./components/discovery";
import { clearStoredCredentials } from "./general/connectionStringManager";
import { checkConfigRevision } from "./general/configRefresh";
import { registerProfilerCodeLens } from "./plugins/profilerCodeLens";
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
  // Sign-out is always available, even before a project loads.
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.clearCredentials", () => clearStoredCredentials(context)));
  // Every project type's commands register ONCE here; handlers resolve which
  // component an invocation targets (#47) — no per-type registration anymore.
  registerAllComponentCommands(context);
  // Profiler toggle CodeLens on [CrmPluginRegistration] classes (#112).
  registerProfilerCodeLens(context);
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

  // Type context keys are workspace-wide "has a component of this type" flags
  // (#47): reset them, then initialise every type present. Single-type
  // workspaces behave exactly as before.
  for (const key of ["isPlugin", "isWebResource", "isSolution", "isPortal", "isPluginV3"]) {
    await vscode.commands.executeCommand("setContext", `dataverse-powertools.${key}`, false);
  }

  const presentTypes = new Set<string>();
  for (const component of context.components) {
    if (component.settings.type) {
      presentTypes.add(component.settings.type);
    }
  }
  if (presentTypes.size === 0 && context.projectSettings.type) {
    presentTypes.add(context.projectSettings.type);
  }

  for (const type of presentTypes) {
    const activation = getProjectTypeActivation(type);
    if (!activation) {
      continue;
    }
    const first = componentsOfType(context.components, type)[0];
    const scoped = first ? componentScopedContext(context, first) : context;
    await activation.initialise(scoped);
    // Stale config-file detection (#113): offer the one-click refresh.
    checkConfigRevision(scoped);
  }
  context.refreshPanel?.();
}
