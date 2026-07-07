import * as vscode from "vscode";
import path = require("path");
import fs = require("fs");
import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes } from "../context";

function isPacPluginInit(argv: string[]): boolean {
  return argv[0]?.toLowerCase() === "pac" && argv[1]?.toLowerCase() === "plugin" && argv[2]?.toLowerCase() === "init";
}

function hasOutputDirectoryFlag(argv: string[]): boolean {
  return argv.some((token) => token.toLowerCase() === "--outputdirectory" || token === "-o");
}

function isDotnetAddWorkflowPackage(argv: string[]): boolean {
  return argv[0]?.toLowerCase() === "dotnet" && argv[1]?.toLowerCase() === "add" && argv[2]?.toLowerCase() === "package" && argv[3]?.toLowerCase() === "microsoft.crmsdk.workflow";
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

/**
 * Resolve a template command for execution.
 *
 * Most template commands are constant strings (run through the shell so Windows
 * `.cmd` wrappers like npm work). The plugin-v3 rewrites, however, interpolate the
 * project name / csproj path — untrusted "library input". To avoid a shell-injection
 * risk those are returned as an argv array and run with `execFile` (no shell), so the
 * values can never be interpreted as shell syntax. Only `pac`/`dotnet` (real
 * executables) are rewritten this way, so `execFile` is safe on all platforms.
 */
function resolveInitCommand(command: string, workspacePath: string, context: DataversePowerToolsContext, initialising: boolean): string | string[] {
  if (!(initialising && context.projectSettings.type === ProjectTypes.plugin && context.projectSettings.templateversion === 3)) {
    return command;
  }

  const projectName = (context.projectSettings.pluginProjectName || "Plugin").trim() || "Plugin";
  const argv = command.split(/\s+/).filter((token) => token.length > 0);

  if (isPacPluginInit(argv)) {
    return hasOutputDirectoryFlag(argv) ? argv : [...argv, "--outputDirectory", projectName];
  }

  if (isDotnetAddWorkflowPackage(argv)) {
    return ["dotnet", "add", resolvePluginCsprojPath(workspacePath, projectName), "package", "Microsoft.CrmSdk.Workflow"];
  }

  return command;
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
      const fullFilePath = context.vscode.asAbsolutePath(path.join("templates", context.projectSettings.type));
      const templates = JSON.parse(fs.readFileSync(path.join(fullFilePath, "template.json"), "utf8")) as Array<PowertoolsTemplate>;
      let templateToCopy = {} as PowertoolsTemplate;
      for (const t of templates) {
        if (t.version === context.projectSettings.templateversion) {
          templateToCopy = t;
          break;
        }
      }
      context.template = templateToCopy;
      if (vscode.workspace.workspaceFolders !== undefined && context.template !== undefined && context.template.restoreCommands) {
        const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const restoreCommands = initialising ? context.template?.initCommands || [] : context.template?.restoreCommands || [];
        for (const c of restoreCommands) {
          const resolvedCommand = resolveInitCommand(c.command, workspacePath, context, initialising);
          const displayCommand = Array.isArray(resolvedCommand) ? resolvedCommand.join(" ") : resolvedCommand;
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Restoring " + displayCommand,
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

export async function restoreDepedencyExec(command: string | string[], workspacePath: string, context: DataversePowerToolsContext) {
  if (vscode.workspace.workspaceFolders === undefined) {
    return;
  }
  const util = require("util");
  const cp = require("child_process");
  const displayCommand = Array.isArray(command) ? command.join(" ") : command;

  // argv arrays run with execFile (no shell); constant strings run through the shell
  // so Windows .cmd wrappers (npm) still work.
  const promise = Array.isArray(command)
    ? util.promisify(cp.execFile)(command[0], command.slice(1), { cwd: workspacePath })
    : util.promisify(cp.exec)(command, { cwd: workspacePath });
  const child = promise.child;

  child.stdout.on("data", function (data: any) {
    if (!data) {
      return;
    }
    if (data.includes("Error") && !data.includes("0 Error")) {
      vscode.window.showErrorMessage("Error restoring " + displayCommand + ". See output for details.");
      context.channel.appendLine(data);
      context.channel.show();
    } else if (data.includes("0 Error")) {
      context.channel.appendLine("Restore Complete.");
      context.channel.appendLine(data);
      context.channel.show();
    } else {
      context.channel.appendLine(data);
    }
  });

  child.stderr.on("data", function (data: any) {
    vscode.window.showErrorMessage("Error restoring " + displayCommand + ". See output for details.");
    context.channel.appendLine(data);
    context.channel.show();
  });

  await promise;
}
