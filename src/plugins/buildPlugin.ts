import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import DataversePowerToolsContext from "../DataversePowerToolsContext";
import { chdir } from "process";

export async function buildPlugin(context: DataversePowerToolsContext) {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Building Plugin...",
  }, async () => {
    await buildPluginExecution(context);
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
      }
      //vscode.window.showErrorMessage("Error building plugins, see output for details.");
    });

    child.stderr.on('data', function (data: any) {
      vscode.window.showErrorMessage("Error building plugins, see output for details.");
    });

    child.error.on('data', function (data: any) {
      vscode.window.showErrorMessage("Error building plugins, see output for details.");
    });
    // child.on('close', function (code: any) {
    //   const test = code;
    //   vscode.window.showInformationMessage("Plugin has been built.");
    // });

    // i.e. can then await for promisified exec call to complete
    const { error, stdout, stderr } = await promise;
  }
}
