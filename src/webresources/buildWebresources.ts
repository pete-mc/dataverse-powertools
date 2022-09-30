import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function buildWebresources(context: DataversePowerToolsContext) {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Building Resources...",
  }, async () => {
    const test = await buildWebresourcesExec(context);
    console.log(test);
  });
}

export async function buildWebresourcesExec(context: DataversePowerToolsContext) {
  const util = require('util');
  const exec = util.promisify(require('child_process').exec);
  let error = false;
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const promise = exec("webpack --config webpack.dev.js", { cwd: workspacePath });
    const child = promise.child; 
    child.stderr.on('data', function(data: any) {
      vscode.window.showInformationMessage("Error building webresources, see output for details.");
      error = true;
      context.channel.appendLine(data);
      context.channel.show();
    });
    child.on('close', function(code: any) {
      if (!error) {
        vscode.window.showInformationMessage("Building Complete");
        return 'success';
      }
    });
    
    const { stdout, stderr } = await promise;
    // cp.exec("webpack --config webpack.dev.js", { cwd: workspacePath }, (error, stdout) => {
    //   if (error) {
    //     vscode.window.showErrorMessage("Error building webresources, see output for details.");
    //     context.channel.appendLine(stdout);
    //     context.channel.appendLine(error.message);
    //     context.channel.show();
    //   } else {
    //     context.channel.appendLine(stdout);
    //     vscode.window.showInformationMessage("Building Complete");
    //   }
    // });
  }
  
}