import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";

interface ExecResult {
  stdout: string;
  stderr: string;
}

function execFileAsync(file: string, args: string[], cwd?: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    cp.execFile(file, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function findBuildTarget(workspacePath: string): Promise<string | undefined> {
  const entries = await fs.promises.readdir(workspacePath, { withFileTypes: true });

  const slnFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sln"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (slnFiles.length > 0) {
    return slnFiles[0];
  }

  const csprojFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csproj"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (csprojFiles.length > 0) {
    return csprojFiles[0];
  }

  return undefined;
}

export async function buildProject(context: DataversePowerToolsContext): Promise<void> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const buildTarget = await findBuildTarget(workspacePath);
  const args = ["build"];

  if (buildTarget) {
    args.push(buildTarget);
    context.channel.appendLine(`Building plugin target: ${buildTarget}`);
  } else {
    context.channel.appendLine("No .sln or .csproj found in workspace root. Running dotnet build in workspace root.");
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Building plugin project...",
    },
    async () => {
      try {
        const { stdout, stderr } = await execFileAsync("dotnet", args, workspacePath);

        if (stdout) {
          context.channel.appendLine(stdout);
        }
        if (stderr) {
          context.channel.appendLine(stderr);
        }

        context.channel.appendLine("Build completed successfully.");
        vscode.window.showInformationMessage("Plugin build completed successfully.");
      } catch (error: any) {
        if (error?.stdout) {
          context.channel.appendLine(error.stdout);
        }
        if (error?.stderr) {
          context.channel.appendLine(error.stderr);
        }
        const message = error?.error?.message || error?.message || "Unknown build error";
        context.channel.appendLine(`Build failed: ${message}`);
        context.channel.show();
        vscode.window.showErrorMessage("Error building plugin project. See output for details.");
      }
    },
  );
}
