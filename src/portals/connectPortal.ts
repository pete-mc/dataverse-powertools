import * as vscode from "vscode";
import * as cp from "child_process";
import DataversePowerToolsContext from "../context";
import { window } from "vscode";
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

async function resolvePacExecutable(): Promise<string> {
  if (process.platform !== "win32") {
    return "pac";
  }

  try {
    const { stdout } = await execFileAsync("where", ["pac"]);
    const firstMatch = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    return firstMatch || "pac";
  } catch {
    return "pac";
  }
}

async function runPac(context: DataversePowerToolsContext, pacExecutable: string, args: string[]) {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const { stdout, stderr } = await execFileAsync(pacExecutable, args, workspacePath);
  if (stderr) {
    context.channel.appendLine(stderr);
  }
  return stdout;
}

export async function getPACLocation(context: DataversePowerToolsContext, command: string) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    const pacExecutable = await resolvePacExecutable();
    await connectPortalExec(context, pacExecutable, command);
  }
}

export async function createPACConnection(context: DataversePowerToolsContext, pacLocation: string, url: string) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    try {
      const stdout = await runPac(context, pacLocation, ["auth", "create", "--url", url]);
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

export async function connectPortalExec(context: DataversePowerToolsContext, pacLocation: string, _command: string) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    try {
      const stdout = await runPac(context, pacLocation, ["auth", "list"]);
      if (stdout !== null && stdout !== "") {
        const connectionStringSplit = context.connectionString.substring(context.connectionString.indexOf("Url=") + 4, context.connectionString.length - 1);
        const name = connectionStringSplit.split(";")[0];
        const arrayOfString = stdout.replace(/\s\s+/g, " ").split(" ");
        const indexOfName = arrayOfString.findIndex((x) => x.includes(name)) - 1;
        const nameOfPortal = arrayOfString[indexOfName];
        context.channel.appendLine(nameOfPortal || "");
        context.channel.show();
        context.channel.appendLine(stdout);
        if (!nameOfPortal) {
          vscode.window.showErrorMessage("Error finding matching portal.");
          await createPACConnection(context, pacLocation, name);
        } else {
          await selectEnvironment(context, pacLocation, nameOfPortal);
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage("Error finding Portals.");
      context.channel.appendLine(error?.error?.message || error?.message || JSON.stringify(error));
      context.channel.show();
    }
  }
}

export async function selectEnvironment(context: DataversePowerToolsContext, pacLocation: string, name: string) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    try {
      const stdout = await runPac(context, pacLocation, ["auth", "select", "-n", name]);
      if (stdout !== null && stdout !== "") {
        const connectionStringSplit = context.connectionString.substring(context.connectionString.indexOf("Url=") + 4, context.connectionString.length - 1);
        const currentName = connectionStringSplit.split(";")[0];
        const arrayOfString = stdout.replace(/\s\s+/g, " ").split(" ");
        const indexOfName = arrayOfString.findIndex((x) => x === currentName) - 1;
        const nameOfPortal = arrayOfString[indexOfName];
        context.channel.appendLine(nameOfPortal || "");
        context.channel.show();

        const authListOutput = await runPac(context, pacLocation, ["auth", "list"]);
        if (authListOutput !== null && authListOutput !== "") {
          context.channel.appendLine(nameOfPortal || "");
          context.channel.show();
          context.channel.appendLine(authListOutput);
          await downloadPortal(context, pacLocation);
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage("Error finding Portals.");
      context.channel.appendLine(error?.error?.message || error?.message || JSON.stringify(error));
      context.channel.show();
    }
  }
}

export async function downloadPortal(context: DataversePowerToolsContext, pacLocation: string) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    try {
      const stdout = await runPac(context, pacLocation, ["pages", "list"]);
      if (stdout !== null && stdout !== "") {
        const arrayOfString = stdout.replace(/\s\s+/g, "\r").split("\r");
        const indexBeforeInformation = arrayOfString.findIndex((x) => x === "Friendly Name") + 1;
        const quickPickArray: { label: string; target: string }[] = [];
        for (let i = indexBeforeInformation; i <= arrayOfString.length - 2; i += 3) {
          quickPickArray.push({ label: arrayOfString[i + 2], target: arrayOfString[i + 1] });
        }

        const result = await window.showQuickPick(quickPickArray, { placeHolder: "Select a Power Pages website." });
        if (!result?.target) {
          return;
        }

        context.channel.appendLine(`${result.label}, ${result.target}`);
        const downloadPath = path.join(workspacePath, "portalpublish");
        const downloadOutput = await runPac(context, pacLocation, ["pages", "download", "-id", result.target, "-p", downloadPath]);
        if (downloadOutput !== null && downloadOutput !== "") {
          context.channel.appendLine(downloadOutput);
          context.channel.show();
        }
        context.channel.show();
        context.channel.appendLine(stdout);
      }
    } catch (error: any) {
      vscode.window.showErrorMessage("Error finding Portals.");
      context.channel.appendLine(error?.error?.message || error?.message || JSON.stringify(error));
      context.channel.show();
    }
  }
}
