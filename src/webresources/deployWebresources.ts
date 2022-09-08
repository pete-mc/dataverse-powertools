import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function deployWebresources(context: DataversePowerToolsContext) {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Building Resources...",
  }, async () => {
    await buildAndDeployExec(context);
  });
  // vscode.window.showInformationMessage("Building");
  // if (vscode.workspace.workspaceFolders !== undefined) {
  //   const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  //   cp.exec("webpack --config webpack.dev.js", { cwd: workspacePath }, (error, stdout) => {
  //     if (error) {
  //       vscode.window.showErrorMessage("Error building webresources, see output for details.");
  //       context.channel.appendLine(stdout);
  //       context.channel.appendLine(error.message);
  //       context.channel.show();
  //     } else {
  //       context.channel.appendLine(stdout);
  //       vscode.window.showInformationMessage("Building Complete, Deploying...");
  //       cp.execFile(
  //         workspacePath + "\\packages\\spkl\\tools\\spkl.exe",
  //         ["webresources", "./spkl.json", context.projectSettings.connectionString || ''],
  //         {
  //           cwd: workspacePath,
  //         },
  //         (error, stdout) => {
  //           if (error) {
  //             vscode.window.showErrorMessage("Error deploying webresources, see output for details.");
  //             context.channel.appendLine(stdout);
  //             context.channel.show();
  //           } else {
  //             context.channel.appendLine(stdout);
  //             vscode.window.showInformationMessage("Webresources Deployed");
  //           }
  //         }
  //       );
  //     }
  //   });
  // }
}

export async function buildAndDeployExec(context: DataversePowerToolsContext) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    const util = require('util');
    const exec = util.promisify(require('child_process').exec);
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const promiseBuild = exec("webpack --config webpack.dev.js", { cwd: workspacePath });
    const childBuild = promiseBuild.child;
    childBuild.stderr.on('data', function (data: any) {
      vscode.window.showInformationMessage("Error building webresources, see output for details.");
    });
    childBuild.on('close', function (code: any) {
      vscode.window.showInformationMessage("Building Complete");
      deploy(context);
    });

    const { stdout, stderr } = await promiseBuild;
  }
}

export async function deploy(context: DataversePowerToolsContext) {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Deploying Resources...",
  }, async () => {
    const util = require('util');
    const exec = util.promisify(require('child_process').execFile);
    if (vscode.workspace.workspaceFolders !== undefined) {
      const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const promiseDeploy = exec(workspacePath + "\\packages\\spkl\\tools\\spkl.exe",
        ["webresources", "./spkl.json", context.projectSettings.connectionString || ''],
        {
          cwd: workspacePath,
        }
      );
      const childDeploy = promiseDeploy.child;
      childDeploy.stderr.on('data', function (data: any) {
        vscode.window.showInformationMessage("Error deploying webresources, see output for details.");
      });
      childDeploy.on('close', function (code: any) {
        vscode.window.showInformationMessage("Deploy Complete");
      });

      const { stdout, stderr } = await promiseDeploy;
    }
  });
}

