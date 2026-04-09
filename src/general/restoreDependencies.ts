import * as vscode from "vscode";
import * as cp from "child_process";
import path = require("path");
import fs = require("fs");
import shellQuote = require("shell-quote");
import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes, RestoreCommand } from "../context";

function appendPacPluginInitOutputDirectory(command: string, projectName: string): string {
  if (!/^pac\s+plugin\s+init\b/i.test(command)) {
    return command;
  }

  if (/\s(--outputDirectory|-o)\b/i.test(command)) {
    return command;
  }

  return `${command} --outputDirectory "${projectName}"`;
}

function resolvePluginCsprojPath(workspacePath: string, projectName: string): string {
  const projectDirectory = path.join(workspacePath, projectName);
  const preferredPath = path.join(projectDirectory, `${projectName}.csproj`);
  if (fs.existsSync(preferredPath)) {
    return preferredPath;
  }

  const legacyPath = path.join(projectDirectory, "Plugin.csproj");
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  if (fs.existsSync(projectDirectory)) {
    const discoveredCsproj = fs
      .readdirSync(projectDirectory)
      .filter((name) => name.toLowerCase().endsWith(".csproj") && !name.toLowerCase().endsWith(".tests.csproj"))
      .sort((a, b) => a.localeCompare(b))[0];

    if (discoveredCsproj) {
      return path.join(projectDirectory, discoveredCsproj);
    }
  }

  return preferredPath;
}

function resolveInitCommand(command: string, workspacePath: string, context: DataversePowerToolsContext, initialising: boolean): string {
  if (!(initialising && context.projectSettings.type === ProjectTypes.plugin && context.projectSettings.templateversion === 3)) {
    return command;
  }

  const projectName = (context.projectSettings.pluginProjectName || "Plugin").trim() || "Plugin";
  let resolved = appendPacPluginInitOutputDirectory(command, projectName);

  if (/^dotnet\s+add\s+package\s+Microsoft\.CrmSdk\.Workflow\b/i.test(resolved)) {
    const pluginCsprojPath = resolvePluginCsprojPath(workspacePath, projectName);
    resolved = `dotnet add "${pluginCsprojPath}" package Microsoft.CrmSdk.Workflow`;
  }

  return resolved;
}

export async function restoreDependencies(context: DataversePowerToolsContext, initialising: boolean = false) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Restoring dependencies...",
    },
    async () => {
      if (!context.projectSettings.type) {
        vscode.window.showErrorMessage("No Template Found; Try reloading extension again");
        return;
      }
      const util = require("util");
      var fullFilePath = context.vscode.asAbsolutePath(path.join("templates", context.projectSettings.type));
      var templates = JSON.parse(fs.readFileSync(fullFilePath + "\\template.json", "utf8")) as Array<PowertoolsTemplate>;
      var templateToCopy = {} as PowertoolsTemplate;
      for (const t of templates) {
        if (t.version === context.projectSettings.templateversion) {
          templateToCopy = t;
          break;
        }
      }
      const stillRunning = false;
      context.template = templateToCopy;
      if (vscode.workspace.workspaceFolders !== undefined && context.template !== undefined && context.template.restoreCommands) {
        const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        let restoreCommands = initialising ? context.template?.initCommands || [] : context.template?.restoreCommands || [];
        for (const c of restoreCommands) {
          const resolvedCommand = resolveInitCommand(c.command, workspacePath, context, initialising);
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Restoring " + resolvedCommand,
            },
            async () => {
              await restoreDepedencyExec(resolvedCommand, workspacePath, context);
            },
          );
        }
        context.channel.appendLine("Restore Complete.");
      } else {
        context.channel.appendLine("No Template Found; Try reloading extension again");
        vscode.window.showErrorMessage("No Template Found; Try reloading extension again");
      }
    },
  );
}

export async function restoreDepedencyExec(command: string, workspacePath: string, context: DataversePowerToolsContext) {
  const util = require("util");
  const execFile = util.promisify(require("child_process").execFile);
  if (vscode.workspace.workspaceFolders !== undefined) {
    const parsed = shellQuote.parse(command).filter((token) => typeof token === "string") as string[];
    if (parsed.length === 0) {
      vscode.window.showErrorMessage("Invalid restore command.");
      return;
    }

    const executable = parsed[0];
    const args = parsed.slice(1);
    const promise = execFile(executable, args, { cwd: workspacePath });
    const child = promise.child;

    child.stdout.on("data", function (data: any) {
      if (!data) {
        return;
      }
      if (data.includes("Error") && !data.includes("0 Error")) {
        vscode.window.showErrorMessage("Error restoring " + command + ". See output for details.");
        context.channel.appendLine(data);
        context.channel.show();
      } else if (data.includes("0 Error")) {
        context.channel.appendLine("Restore Complete.");
        context.channel.appendLine(data);
        context.channel.show();
      } else {
        context.channel.appendLine(data);
        return stdout;
      }
    });

    child.stderr.on("data", function (data: any) {
      vscode.window.showErrorMessage("Error restoring " + command + ". See output for details.");
      context.channel.appendLine(data);
      context.channel.show();
    });

    child.on("close", function (_code: any) {
      return "success";
    });

    const { stdout, stderr } = await promise;
  }
}
