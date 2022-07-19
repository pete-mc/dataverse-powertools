import * as vscode from "vscode";
import DataversePowerToolsContext, { ProjectTypes } from "../DataversePowerToolsContext";

export async function initialiseProject(context: DataversePowerToolsContext) {
    // Settings file test
    context.projectSettings.type = ProjectTypes.plugin;
    context.projectSettings.templateversion = 1;
    // context.projectSettings.connectionString = "my connection string";
    context.createSettings();
}

export async function readProject(context: DataversePowerToolsContext) {
  await context.readSettings();
}

export async function setUISettings(context: DataversePowerToolsContext) {
  let myStatusBarItem: vscode.StatusBarItem;
  if (context.connectionString == '' || context.connectionString == null) {
    vscode.commands.executeCommand('setContext', 'dataverse-powertools.showLoaded', false);
  } else {
    const splitUri = context.connectionString.split(';');
    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    myStatusBarItem.text = splitUri[1].replace('Url=', '');
    myStatusBarItem.show();
    vscode.commands.executeCommand('setContext', 'dataverse-powertools.showLoaded', true);
  }

  switch (context.projectSettings.type) {
    case ProjectTypes.plugin:
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPlugin', true);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isWebResource', false);
    case ProjectTypes.webresource:
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPlugin', true);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isWebResource', false);
  }
}
