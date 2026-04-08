import * as vscode from "vscode";
import * as cs from "./general/initialiseExtension";
import path = require("path");
import fs = require("fs");
import DataversePowerToolsContext, { ProjectTypes } from "./context";
import { pluginTableSelector as pluginTableSelectorOld } from "./plugins_old/pluginTables";
import { pluginTableSelector as pluginTableSelectorV3 } from "./plugins/pluginTables";
import { initialiseWebresources } from "./webresources/initialiseWebresources";
import { initialiseSolutions } from "./solution/initialiseSolutions";
import { initialisePortals } from "./portals/initialisePortals";
import { initialisePlugins } from "./plugins/initialisePlugins";
import { initialisePlugins as initialisePluginsOld } from "./plugins_old/initialisePlugins";
import { registerSystemRequirementCommands } from "./general/systemRequirements";

export async function activate(vscodeContext: vscode.ExtensionContext) {
  const context = new DataversePowerToolsContext(vscodeContext);
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.showLog", () => context.channel.show(true)));
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

  const isPluginV3Project = context.projectSettings.type === ProjectTypes.plugin && context.projectSettings.templateversion === 3;
  const isPluginLegacyProject = context.projectSettings.type === ProjectTypes.plugin && (!context.projectSettings.templateversion || context.projectSettings.templateversion < 3);

  switch (context.projectSettings.type) {
    case ProjectTypes.webresource:
      await initialiseWebresources(context);
      break;
    case ProjectTypes.plugin:
      if (isPluginV3Project) {
        await initialisePlugins(context);
        await pluginTableSelectorV3(context);
      } else {
        context.channel.appendLine("[Deprecated] Plugin template version 2 is deprecated.");
        context.channel.appendLine("[Deprecated] Please create a new Plugin project and manually migrate your plugin code to the new structure.");
        await initialisePluginsOld(context);
        await pluginTableSelectorOld(context);
      }
      break;
    case ProjectTypes.solution:
      await initialiseSolutions(context);
      break;
    case ProjectTypes.portal:
      await initialisePortals(context);
      break;
    case ProjectTypes.pcfdataset:
    case ProjectTypes.pcffield:
      throw new Error("Function not implemented.");
  }
}
