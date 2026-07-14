import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { runPac } from "../general/modelbuilder/commandRunner";
import { activeComponentRoot } from "../components/componentDiscovery";

const SOLUTION_DOCS_URL = "https://learn.microsoft.com/power-apps/developer/component-framework/import-custom-controls";

/** Find the first `.cdsproj` (a pac solution project) in a directory. */
function findCdsproj(directory: string): string | undefined {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const cdsproj = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".cdsproj"));
  return cdsproj ? path.join(directory, cdsproj.name) : undefined;
}

/** Locate a solution project (`.cdsproj`) directory in the workspace: root folders
 * plus their immediate subfolders (the usual monorepo / multi-component layout). */
function findSolutionProjectDir(): string | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = folder.uri.fsPath;
    if (findCdsproj(root)) {
      return root;
    }
    let subdirs: fs.Dirent[];
    try {
      subdirs = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of subdirs) {
      if (entry.isDirectory()) {
        const child = path.join(root, entry.name);
        if (findCdsproj(child)) {
          return child;
        }
      }
    }
  }
  return undefined;
}

// A PCF control ships INSIDE a solution. For a release build you add the control's
// pcfproj as a reference to a solution project (`.cdsproj`) and pack/import that.
// For v1 (#141) this command guides the user to the Solution component and, when a
// solution project already exists in the workspace, best-effort wires the reference
// via `pac solution add-reference --path <pcfComponentRoot>` (a local, auth-free op).
// Deeper solution integration is a fast-follow — `pac pcf push` remains the one-click
// inner loop.
export async function deployPcf(context: DataversePowerToolsContext): Promise<void> {
  const componentRoot = activeComponentRoot(context);
  if (!componentRoot) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  const solutionDir = findSolutionProjectDir();
  if (!solutionDir) {
    context.channel.appendLine(
      "A PCF control ships inside a solution. Add a Solution component to this workspace (Add Component → Solution), then run this again to reference the control — or use Push to deploy it directly to the environment for development.",
    );
    const choice = await vscode.window.showInformationMessage(
      "A PCF control ships inside a solution. Add a Solution component (or use Push for a quick dev deploy), then add the control as a reference.",
      "Learn more",
    );
    if (choice === "Learn more") {
      void vscode.env.openExternal(vscode.Uri.parse(SOLUTION_DOCS_URL));
    }
    return;
  }

  const confirm = await vscode.window.showInformationMessage(
    `Add this PCF control as a reference to the solution project in ${path.basename(solutionDir)}?`,
    "Add reference",
    "Cancel",
  );
  if (confirm !== "Add reference") {
    return;
  }

  try {
    // `pac solution add-reference` runs inside the cdsproj folder and records a
    // reference to the pcfproj — no Dataverse auth required.
    const { stdout, stderr } = await runPac(["solution", "add-reference", "--path", componentRoot], solutionDir);
    if (stdout) {
      context.channel.appendLine(stdout);
    }
    if (stderr) {
      context.channel.appendLine(stderr);
    }
    context.channel.appendLine("PCF control added as a solution reference. Deploy the solution to push it to the environment.");
    vscode.window.showInformationMessage("PCF control added to the solution. Deploy the solution to publish it.");
  } catch (error: any) {
    if (error?.stdout) {
      context.channel.appendLine(error.stdout);
    }
    if (error?.stderr) {
      context.channel.appendLine(error.stderr);
    }
    context.channel.appendLine(`Error running pac solution add-reference: ${error?.error?.message || error?.message || "Unknown error"}`);
    context.channel.show();
    vscode.window.showErrorMessage("Could not add the PCF control to the solution. See output for details.");
  }
}
