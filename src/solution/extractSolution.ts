import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { pacSolutionExportArgs, pacSolutionUnpackArgs } from "./pacArgs";
import { managedZipPath } from "./solutionConfig";
import { ensurePacAuth, getEnvironmentUrl, loadSolutionConfig, runPacSolution } from "./pacRunner";

export async function extractSolution(context: DataversePowerToolsContext) {
  vscode.window.showInformationMessage("Extracting Solution");
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Extracting Solution...",
    },
    async () => {
      await extractSolutionExec(context);
    },
  );
}

export async function extractSolutionExec(context: DataversePowerToolsContext): Promise<boolean> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return false;
  }
  const workspacePath = folders[0].uri.fsPath;

  const config = await loadSolutionConfig(context, workspacePath);
  if (!config) {
    return false;
  }

  if (!(await ensurePacAuth(context, workspacePath))) {
    return false;
  }

  const environmentUrl = getEnvironmentUrl(context);

  // Export the solution zip from Dataverse, then unpack into the source folder.
  // For a Managed-only config, export the managed zip to the base path. For "Both",
  // export the unmanaged base zip plus a managed sibling so SolutionPackager can
  // produce a combined unpack.
  const wantsManagedBase = config.packageType === "Managed";
  let ok = await runPacSolution(context, pacSolutionExportArgs(config, { managed: wantsManagedBase, environmentUrl }), workspacePath);
  if (ok && config.packageType === "Both") {
    ok = await runPacSolution(context, pacSolutionExportArgs(config, { managed: true, environmentUrl, zipPath: managedZipPath(config.zipPath) }), workspacePath);
  }
  if (ok) {
    ok = await runPacSolution(context, pacSolutionUnpackArgs(config), workspacePath);
  }

  if (ok) {
    vscode.window.showInformationMessage("Solution has been extracted.");
  } else {
    vscode.window.showErrorMessage("Error extracting solution, see output for details.");
  }
  return ok;
}
