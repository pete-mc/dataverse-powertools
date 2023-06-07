import * as vscode from "vscode";
import * as cp from "child_process";
import DataversePowerToolsContext from "../context";
import path = require("path");

export async function createSNKKey(context: DataversePowerToolsContext) {
  if (!context.projectSettings.type || !context.projectSettings.templateversion || !vscode.workspace.workspaceFolders) {
    return;
  }
  var fullFilePath = context.vscode.asAbsolutePath(path.join("templates"));
  var localPath = vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + getProjectName(context);
  cp.execFile(fullFilePath + "\\sn.exe", ["-k", localPath + "\\Plugin.snk"], (error, stdout) => {
    if (error) {
      vscode.window.showErrorMessage("Error creating SNK Key.");
      context.channel.appendLine(error.message);
      context.channel.appendLine(stdout);
      context.channel.appendLine("Error Creating SNK Key");
      vscode.window.showErrorMessage(error.message);
      context.channel.show();
    } else {
      context.channel.appendLine(stdout);
      vscode.window.showInformationMessage("Key has been generated.");
    }
  });
}

export function getProjectName(context: DataversePowerToolsContext): string {
  if (!context.projectSettings.placeholders) {
    return "plugins_src";
  }
  for (let i = 0; i < context.projectSettings.placeholders.length; i++) {
    if (context.projectSettings.placeholders[i].placeholder === "PROJECTNAMESPACE") {
      return context.projectSettings.placeholders[i].value;
    }
  }
  return "plugins_src";
}

export async function generateEarlyBound(context: DataversePowerToolsContext) {
  if (!context.projectSettings.type || !context.projectSettings.templateversion || !vscode.workspace.workspaceFolders) {
    return;
  }
  var solutionName = getProjectName(context);

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + solutionName + "\\generated"));
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\logs"));
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating early bound classes...",
    },
    async () => {
      if (!context.projectSettings.type || !context.projectSettings.templateversion || !vscode.workspace.workspaceFolders) {
        return;
      }
      var fullFilePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      cp.execFile(
        fullFilePath + "\\packages\\spkl\\tools\\spkl.exe",
        ["earlybound", `..\\${solutionName}\\spkl.json`, context.connectionString],
        { cwd: fullFilePath + "\\logs" },
        (error, stdout) => {
          if (error) {
            vscode.window.showErrorMessage("Error creating Earlybound types.");
            context.channel.appendLine(error.message);
            context.channel.appendLine(stdout);
            context.channel.appendLine("Error Creating Earlybound types");
            context.channel.show();
          } else {
            context.channel.appendLine(stdout);
            vscode.window.showInformationMessage("Earlybound types has been generated.");
          }
        },
      );
    },
  );
}
