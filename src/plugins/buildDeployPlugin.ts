import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function buildDeployPlugin(context: DataversePowerToolsContext) {
  vscode.window.showInformationMessage("Building");
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Building Plugin...",
  }, async () => {
    await buildPlugin(context);
  });
  // if (vscode.workspace.workspaceFolders !== undefined) {
  //   const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  //   cp.execFile("dotnet", ["build"], { cwd: workspacePath }, (error, stdout) => {
  //     if (error) {
  //       vscode.window.showErrorMessage("Error building plugins, see output for details.");
  //       context.channel.appendLine(stdout);
  //       context.channel.show();
  //     } else {
  //       context.channel.appendLine(stdout);
  //       vscode.window.showInformationMessage("Built");
  //       vscode.window.showInformationMessage("Deploying Now");
  //       cp.execFile(
  //         workspacePath + "\\packages\\spkl\\tools\\spkl.exe",
  //         ["plugins", "./plugins_src/spkl.json", context.connectionString],
  //         {
  //           cwd: workspacePath,
  //         },
  //         (error, stdout) => {
  //           if (error) {
  //             vscode.window.showErrorMessage("Error deploying plugin, see output for details.");
  //             context.channel.appendLine(stdout);
  //             context.channel.show();
  //           } else {
  //             context.channel.appendLine(stdout);
  //             vscode.window.showInformationMessage("Plugin Deployed");
  //           }
  //         }
  //       );
  //     }
  //   });
  // }
}

export async function buildPlugin(context: DataversePowerToolsContext) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const util = require('util');
    const exec = util.promisify(require('child_process').execFile);
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
        deployPlugin(context);
      }
      //vscode.window.showErrorMessage("Error building plugins, see output for details.");
    });

    child.stderr.on('data', function(data: any) {
      vscode.window.showInformationMessage("Error building plugins, see output for details.");
    });


    // child.on('close', function(code: any) {
    //   vscode.window.showInformationMessage("Building Complete");
    //   deployPlugin(context)
    // });
    
    const { error, stdout, stderr } = await promise;
  }
}

export async function deployPlugin(context: DataversePowerToolsContext) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const util = require('util');
    const exec = util.promisify(require('child_process').execFile);
    const promise = exec(workspacePath + "\\packages\\spkl\\tools\\spkl.exe",
    ["plugins", "./plugins_src/spkl.json", context.connectionString],
    {
      cwd: workspacePath,
    });
    const child = promise.child; 

    child.stdout.on('data', function (data: any) {
      const test = data;
      if (data.includes('Error') && !data.includes('0 Error')) {
        vscode.window.showErrorMessage("Error building plugins, see output for details.");
      } else if (data.includes('0 Error')) {
        vscode.window.showInformationMessage("Building Plugin Successful.");
      }
      context.channel.appendLine(data);
      context.channel.show();
    });

    child.stderr.on('data', function(data: any) {
      vscode.window.showInformationMessage("Error building plugins, see output for details.");
    });


    // child.on('close', function(code: any) {
    //   vscode.window.showInformationMessage("Building Complete");
    //   deployPlugin(context)
    // });
    
    const { error, stdout, stderr } = await promise;
  }
}
