import * as vscode from "vscode";
import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes } from "../context";
import path = require("path");
import fs = require("fs");

export async function initialiseProject(context: DataversePowerToolsContext) {
  // Settings file test
  context.projectSettings.type = ProjectTypes.plugin;
  context.projectSettings.templateversion = 1;
  context.createSettings();
}

export async function readProject(context: DataversePowerToolsContext) {
  await context.readSettings(context);
}

export async function setUISettings(context: DataversePowerToolsContext) {
  let myStatusBarItem: vscode.StatusBarItem;
  if (context.projectSettings?.connectionString === undefined || context.projectSettings?.connectionString === '' || context.projectSettings?.connectionString === null) {
    vscode.commands.executeCommand('setContext', 'dataverse-powertools.showLoaded', false);
  } else {
    const splitUri = context.projectSettings.connectionString.split(';');
    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    myStatusBarItem.text = splitUri[2].replace('Url=', '');
    myStatusBarItem.show();
    vscode.commands.executeCommand('setContext', 'dataverse-powertools.showLoaded', true);
  }

  switch (context.projectSettings.type) {
    case ProjectTypes.plugin:
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPlugin', true);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isWebResource', false);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isSolution', false);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPortal', false);
      break;
    case ProjectTypes.webresource:
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPlugin', false);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isWebResource', true);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isSolution', false);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPortal', false);
      if (context.projectSettings.type && context.projectSettings.templateversion && vscode.workspace.workspaceFolders) {
        if (vscode.workspace.workspaceFolders !== undefined && context.projectSettings.templateversion && vscode.workspace.workspaceFolders) {
          var fullFilePath = context.vscode.asAbsolutePath(path.join("templates", context.projectSettings.type));
          var templates = JSON.parse(fs.readFileSync(fullFilePath + "\\template.json", "utf8")) as Array<PowertoolsTemplate>;
          context.template = templates[0];
        }
      }
      break;
    case ProjectTypes.solution:
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPlugin', false);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isWebResource', false);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isSolution', true);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPortal', false);
      break;
    case ProjectTypes.portal:
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPlugin', false);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isWebResource', false);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isSolution', false);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPortal', true);
      break;
    case ProjectTypes.pcfdataset:
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPlugin', false);
  }
}

