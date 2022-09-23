import * as vscode from 'vscode';
import * as cp from "child_process";
import path = require("path");
import fs = require("fs");

import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes } from '../DataversePowertoolsContext';

export async function restoreDependencies(context: DataversePowerToolsContext) {
  const util = require('util');
  const execFile = util.promisify(cp.exec);
  vscode.window.showInformationMessage('Restoring dependencies...');
  var fullFilePath = '';
  if (context.projectSettings.type === 'webresources') {
    fullFilePath = context.vscode.asAbsolutePath(path.join("templates", 'webresources'));
  }
  var templates = JSON.parse(fs.readFileSync(fullFilePath + "\\template.json", "utf8")) as Array<PowertoolsTemplate>;
  var templateToCopy = {} as PowertoolsTemplate;
  for (const t of templates) {
    if (t.version === context.projectSettings.templateversion) {
      templateToCopy = t;
      break;
    }
  }

  vscode.window.showInformationMessage('Restoring dependencies...');
  const stillRunning = false;
  context.template = templateToCopy;
  if (vscode.workspace.workspaceFolders !== undefined && context.template !== undefined && context.template.restoreCommands) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    for (const c of context.template?.restoreCommands || []) {
      const { error, stdout } = await execFile(c.command, { cwd: workspacePath });
      if (error) {
        vscode.window.showErrorMessage("Error running " + c.command + " " + c.params.join(" "));
        context.channel.appendLine(stdout);
        context.channel.show();
        return false;
      }
      else {
        vscode.window.showInformationMessage("Successfully ran: " + c.command);
        context.channel.appendLine(stdout);
      }
    }
    vscode.window.showInformationMessage('Restore Complete.');
  } else {
    vscode.window.showErrorMessage("No Template Found; Try reloading extension again");
  }
};
