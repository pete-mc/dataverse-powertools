import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { pacSolutionPackArgs } from "./pacArgs";
import { loadSolutionConfig, runPacSolution } from "./pacRunner";
import { activeComponentRoot } from "../components/componentDiscovery";

export async function packSolution(context: DataversePowerToolsContext) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Packing Solution...",
    },
    async () => {
      await packSolutionExec(context);
    },
  );
}

export async function packSolutionExec(context: DataversePowerToolsContext): Promise<boolean> {
  const workspacePath = activeComponentRoot(context);
  if (!workspacePath) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return false;
  }

  const config = await loadSolutionConfig(context, workspacePath);
  if (!config) {
    return false;
  }

  // Packing is a local operation (no Dataverse auth needed). For "Both" we produce
  // both the unmanaged and managed zips, mirroring SolutionPackager behaviour.
  let ok = await runPacSolution(context, pacSolutionPackArgs(config, false), workspacePath);
  if (ok && config.packageType === "Both") {
    ok = await runPacSolution(context, pacSolutionPackArgs(config, true), workspacePath);
  }

  if (ok) {
    vscode.window.showInformationMessage("Solution has been packed.");
  } else {
    vscode.window.showErrorMessage("Error packing solution, see output for details.");
  }
  return ok;
}
