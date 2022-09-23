import * as vscode from "vscode";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function deploySolution(context: DataversePowerToolsContext) {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Deploying Solution...",
  }, async () => {
    await deploySolutionExec(context);
  });
}

export async function deploySolutionExec(context: DataversePowerToolsContext) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const util = require('util');
    const exec = util.promisify(require('child_process').execFile);
    const promise = exec(workspacePath + "\\packages\\spkl\\tools\\spkl.exe",
    ["import", "./spkl.json", context.connectionString],
    {
      cwd: workspacePath,
    });
    const child = promise.child; 

    child.stdout.on('data', function (data: any) {
      const test = data;
      if (data.includes('Processed')) {
        vscode.window.showInformationMessage("Solution has been Deployed.");
      } else if (data.includes('0 Error')) {
        // vscode.window.showInformationMessage("Deploying Plugin Successful.");
      }
      context.channel.appendLine(data);
      context.channel.show();
    });

    child.stderr.on('data', function(data: any) {
      vscode.window.showInformationMessage("Error deploying plugins, see output for details.");
    });

    child.on('close', function (code: any) {
      //const test = code;
      //vscode.window.showInformationMessage("Solution has been extracted.");
    });

    const { error, stdout, stderr } = await promise;
  }
}