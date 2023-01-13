import * as vscode from "vscode";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function buildPlugin(context: DataversePowerToolsContext) {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Building Plugin...",
  }, async () => {
    await buildPluginExecution(context);

  });
}

export async function buildPluginExecution(context: DataversePowerToolsContext) {
  const util = require('util');
  const exec = util.promisify(require('child_process').execFile);
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;


    const promise = exec("dotnet", ["build"], { cwd: workspacePath });
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

    child.stderr.on('data', function (_data: any) {
      vscode.window.showErrorMessage("Error building plugins, see output for details.");
    });

    child.on('close', function (_code: any) {
      return 'success';
    });

    const { stdout, stderr } = await promise;
  }
}
