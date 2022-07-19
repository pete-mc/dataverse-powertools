import * as vscode from "vscode";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function initialiseProject(context: DataversePowerToolsContext) {
  // Settings file test
  context.projectSettings.type = "plugin";
  context.projectSettings.templateversion = 1;
  // context.projectSettings.connectionString = "my connection string";
  context.createSettings();
}

export async function readProject(context: DataversePowerToolsContext) {
  await context.readSettings();
}

export async function setUISettings(context: DataversePowerToolsContext) {
  if (context.connectionString == '' || context.connectionString == null) {
    vscode.commands.executeCommand('setContext', 'dataverse-powertools.showLoaded', false);
  } else {
    vscode.commands.executeCommand('setContext', 'dataverse-powertools.showLoaded', true);
  }

  switch (context.projectSettings.type) {
    case 'plugin':
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPlugin', true);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isWebResource', false);
    case 'webresource':
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPlugin', true);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isWebResource', false);
    case 'pcfcontrol':

  }
}
