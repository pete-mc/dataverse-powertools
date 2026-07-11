import * as vscode from "vscode";
import path = require("path");
import fs = require("fs");
import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes } from "../context";
import { getTemplateFolderForType } from "../projectTypes/registry";
import { pacInvocation } from "./pac";

// Lines from restore tooling (npm mostly) that are noise to a user watching the output channel:
// funding solicitations, audit summaries, deprecation notices. Stripped so the log shows only what
// the restore actually did.
const RESTORE_NOISE = [
  /packages? are looking for funding/i,
  /run `npm fund`/i,
  /npm audit/i,
  /found \d+ (low|moderate|high|critical|vulnerabilit)/i,
  /\d+ vulnerabilit/i,
  /to address (all|these|the) (issues|vulnerabilit)/i,
  /^npm (warn|notice|WARN|notice)/i,
  /npm warn deprecated/i,
  /this is deprecated/i,
];

/** Strip funding/audit/deprecation noise from a chunk of restore output. Returns "" if nothing left. */
export function filterRestoreNoise(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !RESTORE_NOISE.some((re) => re.test(line)))
    .join("\n");
}

function isPacPluginInit(argv: string[]): boolean {
  return argv[0]?.toLowerCase() === "pac" && argv[1]?.toLowerCase() === "plugin" && argv[2]?.toLowerCase() === "init";
}

function hasOutputDirectoryFlag(argv: string[]): boolean {
  return argv.some((token) => token.toLowerCase() === "--outputdirectory" || token === "-o");
}

function isDotnetAddWorkflowPackage(argv: string[]): boolean {
  return argv[0]?.toLowerCase() === "dotnet" && argv[1]?.toLowerCase() === "add" && argv[2]?.toLowerCase() === "package" && argv[3]?.toLowerCase() === "microsoft.crmsdk.workflow";
}

/**
 * Constrain a plugin project name to characters valid in a folder/project name before it is
 * interpolated into a file path and passed to `dotnet` — strips path separators and any shell
 * metacharacters, so untrusted project settings can't escape the intended directory or command.
 */
function sanitizeProjectName(name: string | undefined): string {
  const cleaned = (name || "").trim().replace(/[^A-Za-z0-9_.-]/g, "");
  return cleaned || "Plugin";
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
 * Most template commands are returned as-is (constant strings) and validated against
 * ALLOWED_ARGV before execution. The plugin-v3 rewrites interpolate the project name /
 * csproj path — untrusted "library input" — so those are returned as an argv array and
 * run with `execFile` (no shell), where the values can't be interpreted as shell syntax.
 */
function resolveInitCommand(command: string, workspacePath: string, context: DataversePowerToolsContext, initialising: boolean): string | string[] {
  if (!(initialising && context.projectSettings.type === ProjectTypes.plugin && context.projectSettings.templateversion === 3)) {
    return command;
  }

  const projectName = sanitizeProjectName(context.projectSettings.pluginProjectName);
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
      const fullFilePath = context.vscode.asAbsolutePath(path.join("templates", getTemplateFolderForType(context.projectSettings.type)!));
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

// The exact set of commands our bundled templates are allowed to run, as argv
// literals. A template command (read from template.json) is only executed if it
// matches one of these entries — and when it does, the argv handed to the child
// process comes from THIS constant list, never from the file. That's defense in
// depth against a tampered template.json and means no file-derived string is ever
// passed to a shell. Keep in sync with templates/<type>/template.json.
const ALLOWED_ARGV: ReadonlyArray<ReadonlyArray<string>> = [
  ["dotnet", "restore"],
  ["dotnet", "new", "tool-manifest"],
  ["dotnet", "new", "tool-manifest", "--force"],
  ["dotnet", "tool", "install", "paket", "--version", "9.0.2"],
  ["dotnet", "tool", "restore"],
  ["dotnet", "paket", "install"],
  ["dotnet", "add", "package", "Microsoft.CrmSdk.Workflow"],
  ["pac", "plugin", "init", "--skip-signing"],
  ["npm", "install", "--loglevel=error"],
  // Pin to TypeScript 5.x: @typescript-eslint/* v8 (installed below) peers on
  // typescript ">=4.8.4 <6.1.0", and a bare install now resolves to TypeScript 7,
  // which fails `npm i` with ERESOLVE.
  ["npm", "install", "typescript@^5", "--loglevel=error"],
  // prettier-ignore
  ["npm", "i", "eslint", "eslint-config-prettier", "@types/jest", "@typescript-eslint/eslint-plugin", "@typescript-eslint/parser", "jest", "jest-cli", "prettier", "syswide-cas", "ts-jest", "ts-loader", "webpack", "webpack-cli", "webpack-merge", "xrm-mock", "eslint-plugin-prettier", "jest-junit", "exports-loader", "--save-dev", "--loglevel=error"],
];

/**
 * Resolve a command to the argv we'll actually run:
 * - argv arrays (the plugin-v3 rewrites, which interpolate a project name / path) are
 *   used as-is and run via execFile with no shell — those values can't reach a shell.
 * - a plain command string must match an entry in ALLOWED_ARGV; the returned argv is a
 *   copy of that constant entry, so nothing derived from template.json flows onward.
 * Returns undefined for an unrecognised command.
 */
export function resolveExecArgv(command: string | string[]): string[] | undefined {
  if (Array.isArray(command)) {
    return command.length > 0 ? command : undefined;
  }
  const match = ALLOWED_ARGV.find((argv) => argv.join(" ") === command);
  return match ? [...match] : undefined;
}

export async function restoreDepedencyExec(command: string | string[], workspacePath: string, context: DataversePowerToolsContext) {
  if (vscode.workspace.workspaceFolders === undefined) {
    return;
  }
  const displayCommand = Array.isArray(command) ? command.join(" ") : command;
  const argv = resolveExecArgv(command);
  if (!argv) {
    context.channel.appendLine(`Refusing to run unrecognised restore command: ${displayCommand}`);
    context.channel.show();
    return;
  }

  const util = require("util");
  const cp = require("child_process");
  // Decide how to spawn. On Windows `pac` is a .cmd shim with no bare `pac`/`pac.exe`,
  // so execFile can't launch it directly (spawn pac ENOENT) — route it through
  // `cmd.exe /c pac …` via pacInvocation (the same helper the modelbuilder path uses).
  // npm/npx are also Windows .cmd wrappers; give those shell:true. Argv is constant.
  let spawnCommand = argv[0];
  let spawnArgs = argv.slice(1);
  let needsShell = false;
  if (argv[0] === "pac") {
    const inv = pacInvocation(argv.slice(1));
    spawnCommand = inv.command;
    spawnArgs = inv.args;
  } else if (process.platform === "win32" && (argv[0] === "npm" || argv[0] === "npx")) {
    needsShell = true;
  }
  const promise = util.promisify(cp.execFile)(spawnCommand, spawnArgs, { cwd: workspacePath, shell: needsShell });
  const child = promise.child;

  child.stdout.on("data", function (rawData: any) {
    const data = filterRestoreNoise(String(rawData ?? ""));
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

  child.stderr.on("data", function (rawData: any) {
    // Tools write warnings/progress to stderr too, so don't treat every line as an error (a real
    // failure rejects the awaited promise below). Just surface the non-noise lines in the log.
    const data = filterRestoreNoise(String(rawData ?? ""));
    if (data) {
      context.channel.appendLine(data);
    }
  });

  await promise;
}
