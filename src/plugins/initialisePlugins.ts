import DataversePowerToolsContext from "../context";
import * as vscode from "vscode";
import { loadPluginModelBuilderSettings, updatePluginModelBuilderSettingsContext } from "../general/modelbuilder";
import { createPluginTestController } from "./pluginTestController";

// Per-type setup for plugin (v3) components: context keys, model-builder
// settings, test controller. Commands and the decoration CodeLens register ONCE
// globally in extension.ts / projectTypes/activation.ts (#47) — never here, or a
// second plugin component's initialise re-registers and VS Code throws
// "command … already exists".
export async function initialisePlugins(context: DataversePowerToolsContext): Promise<void> {
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPlugin", true);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPluginV3", true);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasPluginUnitTesting", !!context.projectSettings.pluginUnitTestingEnabled);
  await loadPluginModelBuilderSettings(context);
  void updatePluginModelBuilderSettingsContext(context);
  // Surface the plugin's .NET tests in the native Test Explorer (#84).
  createPluginTestController(context);
}
