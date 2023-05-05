import * as vscode from 'vscode';
import * as cp from "child_process";
import path = require("path");
import fs = require("fs");

import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes } from '../context';
import { resolve } from 'path';

export async function restoreDependencies(context: DataversePowerToolsContext) {
  const util = require('util');
  const execFile = util.promisify(cp.exec);
  vscode.window.showInformationMessage('Restoring dependencies...');
  var fullFilePath = '';
  if (context.projectSettings.type === 'webresources') {
    fullFilePath = context.vscode.asAbsolutePath(path.join("templates", 'webresources'));
  } else if (context.projectSettings.type === ProjectTypes.pcfdataset) {
    fullFilePath = context.vscode.asAbsolutePath(path.join("templates", ProjectTypes.pcfdataset));
  } else {
    fullFilePath = context.vscode.asAbsolutePath(path.join("templates", 'general'));
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
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Restoring " + c.command,
      }, async () => {
        const test = await restoreDepedencyExec(c.command, workspacePath, context);
      });
    }
    vscode.window.showInformationMessage('Restore Complete.');
  } else {
    vscode.window.showErrorMessage("No Template Found; Try reloading extension again");
  }
};

export async function restoreDepedencyExec(command: string, workspacePath: string, context: DataversePowerToolsContext) {
  const util = require('util');
  const exec = util.promisify(require('child_process').exec);
  if (vscode.workspace.workspaceFolders !== undefined) {
    const promise = exec(command, { cwd: workspacePath });
    const child = promise.child;

    child.stdout.on('data', function (data: any) {
      const test = data;
      if (data.includes('Error') && !data.includes('0 Error')) {
        vscode.window.showErrorMessage("Error building plugins, see output for details.");
        context.channel.appendLine(data);
        context.channel.show();
      } else if (data.includes('0 Error')) {
        vscode.window.showInformationMessage("Building Plugin Successful.");
        context.channel.appendLine(data);
        context.channel.show();
      } else {
        return stdout;
      }
    });

    child.stderr.on('data', function (data: any) {
      vscode.window.showErrorMessage("Error building restoring " + command + ". See output for details.");
      context.channel.appendLine(data);
      context.channel.show();
    });

    child.on('close', function (_code: any) {
      return 'success';
    });

    const { stdout, stderr } = await promise;
  }
}
