import * as vscode from "vscode";
import * as cp from "child_process";
import DataversePowerToolsContext from "../context";

export async function buildDeployWorkflow(context: DataversePowerToolsContext) {
  vscode.window.showInformationMessage("Building");
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    cp.execFile("dotnet", ["build"], { cwd: workspacePath }, (error, stdout) => {
      if (error) {
        vscode.window.showErrorMessage("Error building Workflows, see output for details.");
        context.channel.appendLine(stdout);
        context.channel.show();
      } else {
        context.channel.appendLine(stdout);
        vscode.window.showInformationMessage("Built and Deploying to Dataverse");
        cp.execFile(
          workspacePath + "\\packages\\spkl\\tools\\spkl.exe",
          ["workflow", "./plugins_src/spkl.json", context.connectionString],
          {
            cwd: workspacePath,
          },
          (error, stdout) => {
            if (error) {
              vscode.window.showErrorMessage("Error deploying Workflow, see output for details.");
              context.channel.appendLine(stdout);
              context.channel.show();
            } else {
              context.channel.appendLine(stdout);
              vscode.window.showInformationMessage("Workflow Deployed");
            }
          },
        );
      }
    });
  }
}
