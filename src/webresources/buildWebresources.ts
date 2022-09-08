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
    await buildWebresourcesExec(context);
  });
}

export async function buildWebresourcesExec(context: DataversePowerToolsContext) {
  const util = require('util');
  const exec = util.promisify(require('child_process').exec);
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const promise = exec("webpack --config webpack.dev.js", { cwd: workspacePath });
    const child = promise.child; 
    child.stderr.on('data', function(data: any) {
      vscode.window.showInformationMessage("Error building webresources, see output for details.");
    });
    child.on('close', function(code: any) {
      vscode.window.showInformationMessage("Building Complete");
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