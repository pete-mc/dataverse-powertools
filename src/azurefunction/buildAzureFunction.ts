import * as cp from "child_process";
import * as fs from "fs";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";

// Local build of the Azure Functions project: `dotnet build` in the component root.
// Mirrors src/plugins/buildProject.ts — `dotnet` is a real executable, so it is spawned
// directly (unlike npx/pac, which are .cmd shims on Windows).

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

/** Prefer a .sln, else the first .csproj, in the component root. */
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

  return csprojFiles[0];
}

export async function buildAzureFunction(context: DataversePowerToolsContext): Promise<void> {
  const workspacePath = activeComponentRoot(context);
  if (!workspacePath) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  const buildTarget = await findBuildTarget(workspacePath);
  const args = ["build"];
  if (buildTarget) {
    args.push(buildTarget);
    context.channel.appendLine(`Building Azure Function target: ${buildTarget}`);
  } else {
    context.channel.appendLine("No .sln or .csproj found in the component root. Running dotnet build there anyway.");
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Building Azure Function...",
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
        context.channel.appendLine("Azure Function build completed successfully.");
        vscode.window.showInformationMessage("Azure Function build completed successfully.");
      } catch (error: any) {
        if (error?.stdout) {
          context.channel.appendLine(error.stdout);
        }
        if (error?.stderr) {
          context.channel.appendLine(error.stderr);
        }
        context.channel.appendLine(`Azure Function build failed: ${error?.error?.message || error?.message || "Unknown build error"}`);
        context.channel.show();
        vscode.window.showErrorMessage("Error building the Azure Function. See output for details.");
      }
    },
  );
}
