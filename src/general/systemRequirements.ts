import * as vscode from "vscode";
import { exec } from "child_process";
import DataversePowerToolsContext from "../context";

interface SystemRequirementStatus {
  hasDotnet: boolean;
  hasNode: boolean;
  hasPac: boolean;
}

/** Last scan result, kept for the actions panel (#100) — context keys can't be read back. */
export interface SystemRequirementsSnapshot {
  scanning: boolean;
  scanned: boolean;
  dotnet: boolean;
  node: boolean;
  pac: boolean;
}

let snapshot: SystemRequirementsSnapshot = { scanning: false, scanned: false, dotnet: false, node: false, pac: false };

export function getSystemRequirementsStatus(): SystemRequirementsSnapshot {
  return { ...snapshot };
}

// webpack / webpack-cli / jest / typescript are NOT system requirements: the project template
// installs them as LOCAL devDependencies and the extension runs them from there (build via
// `npx webpack`, tests via the local jest). Requiring them globally used to nag users into an
// `npm install -g` they don't need — dropped (#94). dotnet / node / pac remain genuine prereqs.

function execCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: 20000 }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function setRequirementContexts(result: SystemRequirementStatus) {
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasDotnet", result.hasDotnet);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasNode", result.hasNode);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasPac", result.hasPac);
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execCommand(command);
    return true;
  } catch {
    return false;
  }
}

async function detectPacInstalled(): Promise<boolean> {
  if (await commandExists("pac --version")) {
    return true;
  }

  if (await commandExists("pac help")) {
    return true;
  }

  if (process.platform === "win32") {
    if (await commandExists("where pac")) {
      return true;
    }

    if (await commandExists("where pac.exe")) {
      return true;
    }

    return commandExists('powershell -NoProfile -Command "if (Get-Command pac -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"');
  }

  return commandExists("which pac");
}

function logRequirementLine(context: DataversePowerToolsContext, name: string, passed: boolean) {
  context.channel.appendLine(`${passed ? "✅" : "❌"} ${name}`);
}

export async function scanSystemRequirements(context: DataversePowerToolsContext) {
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.requirementsScanning", true);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.requirementsScanned", false);
  snapshot = { ...snapshot, scanning: true, scanned: false };
  context.refreshPanel?.();

  context.channel.appendLine("Scanning system requirements...");

  const [hasDotnet, hasNode, hasPac] = await Promise.all([commandExists("dotnet --version"), commandExists("node --version"), detectPacInstalled()]);

  const result: SystemRequirementStatus = { hasDotnet, hasNode, hasPac };

  const hasMissingRequirements = !result.hasDotnet || !result.hasNode || !result.hasPac;

  await setRequirementContexts(result);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasMissingRequirements", hasMissingRequirements);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.requirementsScanning", false);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.requirementsScanned", true);
  snapshot = { scanning: false, scanned: true, dotnet: result.hasDotnet, node: result.hasNode, pac: result.hasPac };
  context.refreshPanel?.();

  if (hasMissingRequirements) {
    await vscode.commands.executeCommand("dataversePowerToolsMenu.focus");
  }

  logRequirementLine(context, ".NET SDK", result.hasDotnet);
  logRequirementLine(context, "Node.js", result.hasNode);
  logRequirementLine(context, "Power Platform CLI (pac)", result.hasPac);

  context.channel.appendLine("Requirement scan complete.");
}

export function registerSystemRequirementCommands(context: DataversePowerToolsContext) {
  context.vscode.subscriptions.push(
    vscode.commands.registerCommand("dataverse-powertools.recheckRequirements", async () => {
      await scanSystemRequirements(context);
      vscode.window.showInformationMessage("Dataverse PowerTools requirements scan complete.");
    }),
  );
}
