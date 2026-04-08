import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { upsertDataversePluginAssembly } from "../general/dataverse/getDataversePluginAssembly";
import { PluginStepRegistration, registerPluginSteps } from "../general/dataverse/registerPluginSteps";

interface ExecResult {
  stdout: string;
  stderr: string;
}

interface DecorationInfo {
  filePath: string;
  kind: "plugin" | "workflow";
}

interface ParsedDecorationResult {
  pluginSteps: PluginStepRegistration[];
  workflowCount: number;
}

function execFileAsync(file: string, args: string[], cwd?: string): Promise<ExecResult> {
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

async function findBuildTarget(workspacePath: string): Promise<string | undefined> {
  const entries = await fs.promises.readdir(workspacePath, { withFileTypes: true });
  const slnFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sln"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  if (slnFiles.length > 0) {
    return slnFiles[0];
  }

  const csprojFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csproj"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  if (csprojFiles.length > 0) {
    return csprojFiles[0];
  }

  return undefined;
}

async function findPrimaryCsproj(workspacePath: string): Promise<string | undefined> {
  const entries = await fs.promises.readdir(workspacePath, { withFileTypes: true });
  const csprojFile = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csproj"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))[0];

  return csprojFile ? path.join(workspacePath, csprojFile) : undefined;
}

async function walkDirectory(rootPath: string): Promise<string[]> {
  const results: string[] = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop() as string;
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else {
        results.push(entryPath);
      }
    }
  }

  return results;
}

async function findBuiltAssemblyPath(workspacePath: string, csprojPath: string): Promise<string | undefined> {
  const binPath = path.join(workspacePath, "bin");
  if (!fs.existsSync(binPath)) {
    return undefined;
  }

  const assemblyName = `${path.basename(csprojPath, ".csproj")}.dll`;
  const allFiles = await walkDirectory(binPath);
  const matchingFiles = allFiles.filter((filePath) => path.basename(filePath).toLowerCase() === assemblyName.toLowerCase());
  if (matchingFiles.length === 0) {
    return undefined;
  }

  let latestFile = matchingFiles[0];
  let latestMtime = (await fs.promises.stat(latestFile)).mtimeMs;

  for (let index = 1; index < matchingFiles.length; index++) {
    const candidate = matchingFiles[index];
    const candidateMtime = (await fs.promises.stat(candidate)).mtimeMs;
    if (candidateMtime > latestMtime) {
      latestMtime = candidateMtime;
      latestFile = candidate;
    }
  }

  return latestFile;
}

async function discoverDecorations(workspacePath: string): Promise<DecorationInfo[]> {
  const allFiles = await walkDirectory(workspacePath);
  const sourceFiles = allFiles.filter((filePath) => {
    const lower = filePath.toLowerCase();
    if (!lower.endsWith(".cs")) {
      return false;
    }
    return !lower.includes("\\bin\\") && !lower.includes("\\obj\\") && !lower.includes("\\.git\\");
  });

  const decorations: DecorationInfo[] = [];

  for (const filePath of sourceFiles) {
    const content = await fs.promises.readFile(filePath, "utf8");
    const regex = /\[CrmPluginRegistration\(([\s\S]*?)\)\]/g;
    let match = regex.exec(content);
    while (match) {
      const args = match[1];
      const isWorkflow = args.includes('"WorkflowActivity"');
      const isPluginStep = args.includes("MessageNameEnum.") && args.includes("StageEnum.");

      if (isWorkflow) {
        decorations.push({ filePath, kind: "workflow" });
      } else if (isPluginStep) {
        decorations.push({ filePath, kind: "plugin" });
      }

      match = regex.exec(content);
    }
  }

  return decorations;
}

function splitTopLevelArguments(argumentsText: string): string[] {
  const argumentsList: string[] = [];
  let current = "";
  let inString = false;
  let isEscaped = false;
  let parenDepth = 0;

  for (let index = 0; index < argumentsText.length; index++) {
    const char = argumentsText[index];

    if (inString) {
      current += char;
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === "\\") {
        isEscaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      current += char;
      continue;
    }

    if (char === "(") {
      parenDepth++;
      current += char;
      continue;
    }

    if (char === ")") {
      parenDepth = Math.max(parenDepth - 1, 0);
      current += char;
      continue;
    }

    if (char === "," && parenDepth === 0) {
      argumentsList.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    argumentsList.push(current.trim());
  }

  return argumentsList;
}

function getQuotedStringValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.substring(1, trimmed.length - 1).replace(/\\"/g, '"');
  }

  return trimmed;
}

function parseStage(stageValue: string): number {
  const stageName = stageValue.trim().replace("StageEnum.", "");
  if (stageName === "PreValidation") {
    return 10;
  }
  if (stageName === "PreOperation") {
    return 20;
  }
  return 40;
}

function parseMode(modeValue: string): number {
  const modeName = modeValue.trim().replace("ExecutionModeEnum.", "");
  return modeName === "Asynchronous" ? 1 : 0;
}

function parseStepId(argumentsList: string[]): string | undefined {
  const idArgument = argumentsList.find((argument) => argument.startsWith("Id"));
  if (!idArgument) {
    return undefined;
  }

  const idMatch = idArgument.match(/Id\s*=\s*"([0-9a-fA-F-]{36})"/);
  return idMatch?.[1];
}

function extractNamespace(content: string): string {
  const namespaceMatch = content.match(/namespace\s+([A-Za-z0-9_.]+)/);
  return namespaceMatch?.[1] || "Plugin";
}

function parseDecorationsFromContent(content: string): ParsedDecorationResult {
  const namespaceName = extractNamespace(content);
  const pluginSteps: PluginStepRegistration[] = [];
  let workflowCount = 0;

  const regex = /\[CrmPluginRegistration\(([\s\S]*?)\)\][\s\S]*?public\s+class\s+(\w+)\s*:\s*([^\r\n\{]+)/g;
  let match = regex.exec(content);
  while (match) {
    const argsText = match[1];
    const className = match[2];
    const classInheritance = match[3] || "";
    const args = splitTopLevelArguments(argsText);

    const isWorkflow = argsText.includes('"WorkflowActivity"') || classInheritance.includes("WorkflowBase") || classInheritance.includes("CodeActivity");
    if (isWorkflow) {
      workflowCount++;
      match = regex.exec(content);
      continue;
    }

    const isPluginStep = args.length >= 8 && args[0].includes("MessageNameEnum.") && args[2].includes("StageEnum.");
    if (!isPluginStep) {
      match = regex.exec(content);
      continue;
    }

    const messageName = args[0].replace("MessageNameEnum.", "").trim();
    const entityLogicalName = getQuotedStringValue(args[1]);
    const stage = parseStage(args[2]);
    const mode = parseMode(args[3]);
    const filteringAttributes = getQuotedStringValue(args[4]);
    const stepName = getQuotedStringValue(args[5]);
    const executionOrder = Number(args[6]);
    const stepId = parseStepId(args);

    pluginSteps.push({
      className,
      fullTypeName: `${namespaceName}.${className}`,
      messageName,
      entityLogicalName,
      stage,
      mode,
      filteringAttributes,
      stepName,
      executionOrder: Number.isFinite(executionOrder) ? executionOrder : 1,
      stepId,
    });

    match = regex.exec(content);
  }

  return { pluginSteps, workflowCount };
}

async function discoverRegistrations(workspacePath: string): Promise<ParsedDecorationResult> {
  const sourceFiles = (await walkDirectory(workspacePath)).filter((filePath) => {
    const lower = filePath.toLowerCase();
    if (!lower.endsWith(".cs")) {
      return false;
    }
    return !lower.includes("\\bin\\") && !lower.includes("\\obj\\") && !lower.includes("\\.git\\");
  });

  const pluginSteps: PluginStepRegistration[] = [];
  let workflowCount = 0;

  for (const filePath of sourceFiles) {
    const content = await fs.promises.readFile(filePath, "utf8");
    const parsed = parseDecorationsFromContent(content);
    pluginSteps.push(...parsed.pluginSteps);
    workflowCount += parsed.workflowCount;
  }

  return { pluginSteps, workflowCount };
}

export async function buildAndDeploy(context: DataversePowerToolsContext): Promise<void> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Building and deploying plugin assembly...",
    },
    async () => {
      const buildTarget = await findBuildTarget(workspacePath);
      const buildArgs = ["build"];
      if (buildTarget) {
        buildArgs.push(buildTarget);
      }

      context.channel.appendLine(`Build and Deploy started${buildTarget ? ` for ${buildTarget}` : ""}.`);

      try {
        const buildResult = await execFileAsync("dotnet", buildArgs, workspacePath);
        if (buildResult.stdout) {
          context.channel.appendLine(buildResult.stdout);
        }
        if (buildResult.stderr) {
          context.channel.appendLine(buildResult.stderr);
        }
      } catch (error: any) {
        if (error?.stdout) {
          context.channel.appendLine(error.stdout);
        }
        if (error?.stderr) {
          context.channel.appendLine(error.stderr);
        }
        context.channel.appendLine("Build failed; deployment skipped.");
        context.channel.show();
        vscode.window.showErrorMessage("Build failed. See output for details.");
        return;
      }

      const csprojPath = await findPrimaryCsproj(workspacePath);
      if (!csprojPath) {
        vscode.window.showErrorMessage("No .csproj found in workspace root.");
        return;
      }

      const assemblyPath = await findBuiltAssemblyPath(workspacePath, csprojPath);
      if (!assemblyPath) {
        vscode.window.showErrorMessage("Could not find built assembly DLL in bin output.");
        return;
      }

      const discovered = await discoverRegistrations(workspacePath);
      const pluginCount = discovered.pluginSteps.length;
      const workflowCount = discovered.workflowCount;
      context.channel.appendLine(`Discovered ${pluginCount} plugin step decorations and ${workflowCount} workflow decorations.`);

      const assemblyName = path.basename(assemblyPath, ".dll");
      const assemblyResolution = await upsertDataversePluginAssembly(context, assemblyName, assemblyPath);
      const assemblyId = assemblyResolution.assemblyId;
      if (!assemblyId) {
        context.channel.appendLine(`Unable to resolve or create Dataverse plugin assembly '${assemblyName}'.`);
        vscode.window.showErrorMessage(`Build succeeded, but failed to resolve/create Dataverse plugin assembly '${assemblyName}'. See output for details.`);
        return;
      }

      if (assemblyResolution.created) {
        context.channel.appendLine(`Created Dataverse plugin assembly '${assemblyName}' (${assemblyId}).`);
      } else if (assemblyResolution.updated) {
        context.channel.appendLine(`Updated Dataverse plugin assembly '${assemblyName}' (${assemblyId}).`);
      } else {
        context.channel.appendLine(`Resolved existing Dataverse plugin assembly '${assemblyName}' (${assemblyId}).`);
      }

      const registrationResult = await registerPluginSteps(context, assemblyId, discovered.pluginSteps);
      context.channel.appendLine(
        `Plugin step sync complete. Created: ${registrationResult.created}, Updated: ${registrationResult.updated}, Skipped: ${registrationResult.skipped}.`,
      );

      context.channel.appendLine("Build and Deploy completed.");
      vscode.window.showInformationMessage(
        `Build and Deploy completed (Assembly ${assemblyResolution.created ? "created" : "updated"}, Steps: ${registrationResult.created} created, ${registrationResult.updated} updated, ${registrationResult.skipped} skipped).`,
      );
    },
  );
}
