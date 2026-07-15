import * as vscode from "vscode";
import * as cs from "./general/initialiseExtension";
import path = require("path");
import fs = require("fs");
import DataversePowerToolsContext from "./context";
import { getProjectTypeActivation, registerAllComponentCommands } from "./projectTypes/activation";
import { componentScopedContext } from "./components/componentDiscovery";
import { componentsToInitialise } from "./components/discovery";
import { clearStoredCredentials } from "./general/connectionStringManager";
import { checkConfigRevision } from "./general/configRefresh";
import { registerDecorationCodeLens } from "./plugins/decorationsCodeLens";
import { registerLmTools } from "./lmtools/registerLmTools";
import { registerServerLogicLint } from "./portals/lintServerLogicCommand";
import { registerServerLogicBuild } from "./portals/buildServerLogicCommand";
import { registerPortalFrontendBuild } from "./portals/buildPortalFrontendCommand";
import { registerServerLogicClient } from "./portals/serverLogicClientCommand";
import { registerPortalWebApiClient } from "./portals/portalWebApiClientCommand";
import { registerMenuPanel } from "./panel/menuPanel";
import { refreshPanelData } from "./panel/panelDataCache";
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
  // Language Model Tools for Copilot agent mode (#140) — registered ONCE, globally.
  registerLmTools(context);
  // Power Pages Server Logic lint + build (#150) — active-editor commands, registered ONCE.
  registerServerLogicLint(context);
  registerServerLogicBuild(context);
  registerPortalFrontendBuild(context);
  registerServerLogicClient(context);
  registerPortalWebApiClient(context);
  // Class-decoration / filtering-attribute / per-step-profiling CodeLens on plugin .cs files. Registered
  // ONCE here (its commands + provider are global) — never per plugin component, or a
  // second plugin component's initialise throws "command … already exists" (#47).
  registerDecorationCodeLens(context);
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

  // Initialise EVERY typed component on load (#146) — not just the first of each type —
  // so each component's scoped Test Explorer controller + watchers are created (safe now
  // that controller ids are per-component, #124). Type context keys set inside initialise*
  // are idempotent. A legacy single-project workspace resolves to one root component and
  // behaves exactly as before; a workspace whose only type is on the (undiscovered) root
  // falls back to the base context.
  const toInitialise = componentsToInitialise(context.components);
  if (toInitialise.length > 0) {
    for (const component of toInitialise) {
      const activation = getProjectTypeActivation(component.settings.type);
      if (!activation) {
        continue;
      }
      const scoped = componentScopedContext(context, component);
      await activation.initialise(scoped);
      // Stale config-file detection (#113): offer the one-click refresh.
      checkConfigRevision(scoped);
    }
  } else if (context.projectSettings.type) {
    const activation = getProjectTypeActivation(context.projectSettings.type);
    if (activation) {
      await activation.initialise(context);
      checkConfigRevision(context);
    }
  }
  context.refreshPanel?.();
  // Fetch the Dataverse-derived panel data (trace-log level #137, active profiles #139) from the
  // silently-established connection and cache it, then re-render. Fire-and-forget — the panel
  // renders immediately and updates when the data lands.
  void refreshPanelData(context);
}
