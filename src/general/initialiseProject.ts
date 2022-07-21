import * as vscode from "vscode";
import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes } from "../DataversePowerToolsContext";
import path = require("path");
import fs = require("fs");

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
  if (context.projectSettings?.connectionString == '' || context.projectSettings?.connectionString == null) {
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
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isPlugin', false);
      vscode.commands.executeCommand('setContext', 'dataverse-powertools.isWebResource', true);
      if (context.projectSettings.type && context.projectSettings.templateversion && vscode.workspace.workspaceFolders) {
        if (vscode.workspace.workspaceFolders !== undefined && context.projectSettings.templateversion && vscode.workspace.workspaceFolders) {
          var fullFilePath = context.vscode.asAbsolutePath(path.join("templates", context.projectSettings.type));
          var templates = JSON.parse(fs.readFileSync(fullFilePath + "\\template.json", "utf8")) as Array<PowertoolsTemplate>;
          context.template = templates[0];
            // for (const t of templates) {
            //   if (t.version === context.projectSettings.templateversion) {
            //     // templateToCopy = t;
            //     break;
            //   }
            // }
        }
      }
  }
}

