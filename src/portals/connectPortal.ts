import * as vscode from "vscode";
import * as cp from "child_process";
import DataversePowerToolsContext from "../context";
import { window } from "vscode";
import { getOrganizationUrl } from "../general/connectionString";
import { pacInvocation } from "../general/pac";
import { parsePacAuthList, findAuthProfileForUrl, parsePacPagesList } from "./pacOutput";
import path = require("path");

export async function connectPortal(context: DataversePowerToolsContext, command: string) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Connecting Portal...",
    },
    async () => {
      await getPACLocation(context, command);
    },
  );
}

async function execFileAsync(file: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
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

// Run a pac command and return stdout; pac.ts handles the Windows .cmd invocation.
async function runPac(context: DataversePowerToolsContext, args: string[]) {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const { command, args: invocationArgs } = pacInvocation(args);
  const { stdout, stderr } = await execFileAsync(command, invocationArgs, workspacePath);
  if (stderr) {
    context.channel.appendLine(stderr);
  }
  return stdout;
}

export async function getPACLocation(context: DataversePowerToolsContext, command: string) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    await connectPortalExec(context, command);
  }
}

export async function createPACConnection(context: DataversePowerToolsContext, url: string) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    try {
      const stdout = await runPac(context, ["auth", "create", "--url", url]);
      if (stdout !== null && stdout !== "") {
        context.channel.appendLine(stdout);
        context.channel.show();
      }
    } catch (error: any) {
      vscode.window.showErrorMessage("Error creating auth.");
      context.channel.appendLine(error?.error?.message || error?.message || JSON.stringify(error));
      context.channel.show();
    }
  }
}

export async function connectPortalExec(context: DataversePowerToolsContext, _command: string) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    try {
      const stdout = await runPac(context, ["auth", "list"]);
      if (stdout !== null && stdout !== "") {
        context.channel.appendLine(stdout);
        const targetUrl = getOrganizationUrl(context.connectionString);
        const profile = findAuthProfileForUrl(parsePacAuthList(stdout), targetUrl);
        if (!profile) {
          vscode.window.showErrorMessage("Error finding matching portal.");
          await createPACConnection(context, targetUrl);
        } else {
          // Prefer selecting by profile name; fall back to its index when unnamed.
          const selector = profile.name ? ["-n", profile.name] : profile.index !== undefined ? ["--index", String(profile.index)] : undefined;
          if (!selector) {
            vscode.window.showErrorMessage("Error finding matching portal.");
            return;
          }
          context.channel.appendLine(`Selecting auth profile: ${profile.name || `#${profile.index}`}`);
          context.channel.show();
          await selectEnvironment(context, selector);
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage("Error finding Portals.");
      context.channel.appendLine(error?.error?.message || error?.message || JSON.stringify(error));
      context.channel.show();
    }
  }
}

export async function selectEnvironment(context: DataversePowerToolsContext, selector: string[]) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    try {
      const stdout = await runPac(context, ["auth", "select", ...selector]);
      if (stdout !== null && stdout !== "") {
        context.channel.appendLine(stdout);
        context.channel.show();
      }
      await downloadPortal(context);
    } catch (error: any) {
      vscode.window.showErrorMessage("Error finding Portals.");
      context.channel.appendLine(error?.error?.message || error?.message || JSON.stringify(error));
      context.channel.show();
    }
  }
}

export async function downloadPortal(context: DataversePowerToolsContext) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    try {
      const stdout = await runPac(context, ["pages", "list"]);
      if (stdout !== null && stdout !== "") {
        context.channel.appendLine(stdout);
        const pages = parsePacPagesList(stdout);
        if (pages.length === 0) {
          vscode.window.showErrorMessage("No Power Pages websites were found in this environment.");
          context.channel.show();
          return;
        }
        const quickPickArray = pages.map((page) => ({ label: page.friendlyName || page.websiteId, target: page.websiteId }));

        const result = await window.showQuickPick(quickPickArray, { placeHolder: "Select a Power Pages website." });
        if (!result?.target) {
          return;
        }

        context.channel.appendLine(`${result.label}, ${result.target}`);
        const downloadPath = path.join(workspacePath, "portalpublish");
        const downloadOutput = await runPac(context, ["pages", "download", "-id", result.target, "-p", downloadPath]);
        if (downloadOutput !== null && downloadOutput !== "") {
          context.channel.appendLine(downloadOutput);
        }
        context.channel.show();
      }
    } catch (error: any) {
      vscode.window.showErrorMessage("Error finding Portals.");
      context.channel.appendLine(error?.error?.message || error?.message || JSON.stringify(error));
      context.channel.show();
    }
  }
}
