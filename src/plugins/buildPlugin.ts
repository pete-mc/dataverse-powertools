import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function buildPlugin(context: DataversePowerToolsContext) {
  vscode.window.showInformationMessage("Building");
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    cp.execFile("dotnet", ["build"], { cwd: workspacePath }, (error, stdout) => {
      if (error) {
        vscode.window.showErrorMessage("Error building plugins, see output for details.");
        context.channel.appendLine(stdout);
        context.channel.show();
      } else {
        context.channel.appendLine(stdout);
        vscode.window.showInformationMessage("Built");
      }
    });
  }
}
