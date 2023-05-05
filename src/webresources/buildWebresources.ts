import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";

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
    child.on('close', function(_code: any) {
      if (!error) {
        vscode.window.showInformationMessage("Building Complete");
        return 'success';
      }
      return '';
    });
    const { stdout, stderr } = await promise;
  }
  
}