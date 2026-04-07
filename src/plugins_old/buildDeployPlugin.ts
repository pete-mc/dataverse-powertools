import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { getProjectName } from "./getProjectName";

export async function buildDeployPlugin(context: DataversePowerToolsContext) {
  vscode.window.showInformationMessage("Building");
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Building Plugin...",
    },
    async () => {
      await buildPlugin(context);
    },
  );
}

export async function buildPlugin(context: DataversePowerToolsContext) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const util = require("util");
    const exec = util.promisify(require("child_process").execFile);
    const promise = exec("dotnet", ["build"], { cwd: workspacePath });
    const child = promise.child;

    child.stdout.on("data", function (data: any) {
      const test = data;
      if (data.includes("Error") && !data.includes("0 Error")) {
        vscode.window.showErrorMessage("Error building plugins, see output for details.");
        context.channel.appendLine(data);
        context.channel.show();
      } else if (data.includes("0 Error")) {
        vscode.window.showInformationMessage("Building Plugin Successful.");
        context.channel.appendLine(data);
        context.channel.show();
        deployPlugin(context);
      }
    });

    child.stderr.on("data", function (_data: any) {
      vscode.window.showInformationMessage("Error building plugins, see output for details.");
    });
    const { error, stdout, stderr } = await promise;
  }
}

export async function deployPlugin(context: DataversePowerToolsContext) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Deploying Plugin...",
    },
    async () => {
      await deployPluginExecution(context);
    },
  );
}

export async function deployPluginExecution(context: DataversePowerToolsContext) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    var solutionName = getProjectName(context);
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const util = require("util");
    const exec = util.promisify(require("child_process").execFile);
    const promise = exec(workspacePath + "\\packages\\spkl\\tools\\spkl.exe", ["plugins", `${solutionName}\\spkl.json`, context.connectionString], {
      cwd: workspacePath,
    });
    const child = promise.child;

    child.stdout.on("data", function (data: any) {
      const test = data;
      if (data.includes("Error") && !data.includes("0 Error")) {
        vscode.window.showErrorMessage("Error deploying plugins, see output for details.");
      } else if (data.includes("0 Error")) {
        vscode.window.showInformationMessage("Deploying Plugin Successful.");
      }
      context.channel.appendLine(data);
      context.channel.show();
    });

    child.stderr.on("data", function (_data: any) {
      vscode.window.showInformationMessage("Error deploying plugins, see output for details.");
    });
    const { error, stdout, stderr } = await promise;
  }
}
