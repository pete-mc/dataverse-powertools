import * as vscode from "vscode";
import fs = require("fs");
import path = require("path");
import DataversePowerToolsContext from "../context";

interface SpklWebresourceProfile {
  solution?: string;
}

interface SpklSettings {
  webresources?: SpklWebresourceProfile[];
}

export async function upgradeFromSpkl(context: DataversePowerToolsContext): Promise<void> {
  if (!vscode.workspace.workspaceFolders) {
    return;
  }

  const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const spklPath = path.join(workspacePath, "spkl.json");
  if (!fs.existsSync(spklPath)) {
    vscode.commands.executeCommand("setContext", "dataverse-powertools.hasSpkl", false);
    vscode.window.showInformationMessage("No spkl.json file found.");
    return;
  }

  try {
    const spklRaw = await fs.promises.readFile(spklPath, "utf8");
    const spkl = JSON.parse(spklRaw) as SpklSettings;
    const spklSolutionName = spkl.webresources && spkl.webresources.length > 0 ? spkl.webresources[0].solution : undefined;

    if (spklSolutionName && spklSolutionName.trim() !== "") {
      context.projectSettings.webresourceSolutionName = spklSolutionName;
      if (!context.projectSettings.solutionName) {
        context.projectSettings.solutionName = spklSolutionName;
      }
      context.channel.appendLine(`Upgraded webresource solution from spkl.json: ${spklSolutionName}`);
    }

    await fs.promises.unlink(spklPath);
    await context.writeSettings();
    await context.readSettings();

    vscode.commands.executeCommand("setContext", "dataverse-powertools.hasSpkl", false);
    vscode.window.showInformationMessage("Upgrade from Spkl complete. spkl.json removed and settings updated.");
  } catch (error: any) {
    context.channel.appendLine(`Upgrade from Spkl failed: ${error?.message || JSON.stringify(error)}`);
    context.channel.show();
    vscode.window.showErrorMessage("Upgrade from Spkl failed. See output for details.");
  }
}
