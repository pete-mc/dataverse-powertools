import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { pacSolutionImportArgs, pacSolutionPackArgs } from "./pacArgs";
import { ensurePacAuth, getEnvironmentUrl, loadSolutionConfig, runPacSolution } from "./pacRunner";
import { activeComponentRoot } from "../components/componentDiscovery";

export async function deploySolution(context: DataversePowerToolsContext) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Deploying Solution...",
    },
    async () => {
      await deploySolutionExec(context);
    },
  );
}

export async function deploySolutionExec(context: DataversePowerToolsContext): Promise<boolean> {
  const workspacePath = activeComponentRoot(context);
  if (!workspacePath) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return false;
  }

  const config = await loadSolutionConfig(context, workspacePath);
  if (!config) {
    return false;
  }

  // Pack the source folder into an unmanaged zip locally, then authenticate and
  // import it into Dataverse (spkl's "import" was pack + import to server).
  let ok = await runPacSolution(context, pacSolutionPackArgs(config, false), workspacePath);
  if (ok) {
    if (!(await ensurePacAuth(context, workspacePath))) {
      return false;
    }
    ok = await runPacSolution(context, pacSolutionImportArgs(config, getEnvironmentUrl(context)), workspacePath);
  }

  if (ok) {
    vscode.window.showInformationMessage("Solution has been deployed.");
  } else {
    vscode.window.showErrorMessage("Error deploying solution, see output for details.");
  }
  return ok;
}
