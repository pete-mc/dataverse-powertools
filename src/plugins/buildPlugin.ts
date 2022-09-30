import { rejects } from "assert";
import { resolve } from "path";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function buildPlugin(context: DataversePowerToolsContext) {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Building Plugin...",
  }, async () => {
    const test = await buildPluginExecution(context);
    console.log(test);
    // return new Promise(resolve => setTimeout(resolve, 5000))
    // await testAsyncFunction();
  });
}

export async function buildPluginExecution(context: DataversePowerToolsContext) {
  const util = require('util');
  const exec = util.promisify(require('child_process').execFile);
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    // cp.execFile("dotnet", ["build"], { cwd: workspacePath }, (error, stdout) => {
    //   if (error) {
    //     vscode.window.showErrorMessage("Error building plugins, see output for details.");
    //     context.channel.appendLine(stdout);
    //     context.channel.show();
    //   } else {
    //     context.channel.appendLine(stdout);
    //     vscode.window.showInformationMessage("Built");
    //   }
    // });

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
      //vscode.window.showErrorMessage("Error building plugins, see output for details.");
    });

    child.stderr.on('data', function (data: any) {
      vscode.window.showErrorMessage("Error building plugins, see output for details.");
    });

    child.on('close', function (code: any) {
      return 'success';
      //const test = code;
      //vscode.window.showInformationMessage("Plugin has been built.");
    });

    // i.e. can then await for promisified exec call to complete
    const { stdout, stderr } = await promise;
  }
}
