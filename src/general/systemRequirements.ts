import * as vscode from "vscode";
import { exec } from "child_process";
import DataversePowerToolsContext from "../context";

interface SystemRequirementStatus {
  hasDotnet: boolean;
  hasNode: boolean;
  hasPac: boolean;
  hasGlobalJest: boolean;
  hasGlobalWebpack: boolean;
  hasGlobalWebpackCli: boolean;
  hasGlobalTypescript: boolean;
}

const requiredGlobalPackages = ["jest", "webpack", "webpack-cli", "typescript"];

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
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasGlobalJest", result.hasGlobalJest);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasGlobalWebpack", result.hasGlobalWebpack);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasGlobalWebpackCli", result.hasGlobalWebpackCli);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasGlobalTypescript", result.hasGlobalTypescript);
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

async function scanNpmGlobalPackages(): Promise<Record<string, boolean>> {
  try {
    const { stdout } = await execCommand("npm ls -g --depth=0 --json");
    const parsed = JSON.parse(stdout);
    const dependencies = parsed?.dependencies || {};

    return {
      jest: !!dependencies.jest,
      webpack: !!dependencies.webpack,
      webpackCli: !!dependencies["webpack-cli"],
      typescript: !!dependencies.typescript,
    };
  } catch {
    return {
      jest: false,
      webpack: false,
      webpackCli: false,
      typescript: false,
    };
  }
}

function logRequirementLine(context: DataversePowerToolsContext, name: string, passed: boolean) {
  context.channel.appendLine(`${passed ? "✅" : "❌"} ${name}`);
}

export async function scanSystemRequirements(context: DataversePowerToolsContext) {
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.requirementsScanning", true);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.requirementsScanned", false);

  context.channel.appendLine("Scanning system requirements...");

  const [hasDotnet, hasNode, hasPac, globals] = await Promise.all([
    commandExists("dotnet --version"),
    commandExists("node --version"),
    detectPacInstalled(),
    scanNpmGlobalPackages(),
  ]);

  const result: SystemRequirementStatus = {
    hasDotnet,
    hasNode,
    hasPac,
    hasGlobalJest: globals.jest,
    hasGlobalWebpack: globals.webpack,
    hasGlobalWebpackCli: globals.webpackCli,
    hasGlobalTypescript: globals.typescript,
  };

  const hasMissingRequirements =
    !result.hasDotnet || !result.hasNode || !result.hasPac || !result.hasGlobalJest || !result.hasGlobalWebpack || !result.hasGlobalWebpackCli || !result.hasGlobalTypescript;

  await setRequirementContexts(result);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasMissingRequirements", hasMissingRequirements);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.requirementsScanning", false);
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.requirementsScanned", true);

  if (hasMissingRequirements) {
    await vscode.commands.executeCommand("dataversePowerToolsRequirements.focus");
  }

  logRequirementLine(context, ".NET SDK", result.hasDotnet);
  logRequirementLine(context, "Node.js", result.hasNode);
  logRequirementLine(context, "Power Platform CLI (pac)", result.hasPac);
  logRequirementLine(context, "npm global: jest", result.hasGlobalJest);
  logRequirementLine(context, "npm global: webpack", result.hasGlobalWebpack);
  logRequirementLine(context, "npm global: webpack-cli", result.hasGlobalWebpackCli);
  logRequirementLine(context, "npm global: typescript", result.hasGlobalTypescript);

  context.channel.appendLine("Requirement scan complete.");
}

export function registerSystemRequirementCommands(context: DataversePowerToolsContext) {
  context.vscode.subscriptions.push(
    vscode.commands.registerCommand("dataverse-powertools.recheckRequirements", async () => {
      await scanSystemRequirements(context);
      vscode.window.showInformationMessage("Dataverse PowerTools requirements scan complete.");
    }),
  );

  context.vscode.subscriptions.push(
    vscode.commands.registerCommand("dataverse-powertools.installRequiredGlobals", async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Installing required npm globals...",
          cancellable: false,
        },
        async () => {
          try {
            await execCommand(`npm install -g ${requiredGlobalPackages.join(" ")}`);
            context.channel.appendLine("Installed npm globals: jest webpack webpack-cli typescript");
            await scanSystemRequirements(context);
            vscode.window.showInformationMessage("Required npm globals installed and requirements rechecked.");
          } catch (error) {
            context.channel.appendLine(`Failed to install npm globals: ${JSON.stringify(error)}`);
            vscode.window.showErrorMessage("Failed to install npm globals. See Dataverse PowerTools output for details.");
          }
        },
      );
    }),
  );
}
