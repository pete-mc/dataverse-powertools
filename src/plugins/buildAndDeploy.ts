import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { addDataverseSolutionComponentByObjectId } from "../general/dataverse/addDataverseSolutionComponent";
import { PluginPackageMetadata, upsertDataversePluginPackage, waitForDataversePluginAssemblyFromPackage } from "../general/dataverse/getDataversePluginPackage";
import { PluginStepRegistration, registerPluginSteps } from "../general/dataverse/registerPluginSteps";
import { findPrimaryPluginCsproj } from "./projectPaths";
import { registerWorkflowActivities, WorkflowActivityRegistration } from "../general/dataverse/registerWorkflowActivities";

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
  workflowActivities: WorkflowActivityRegistration[];
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

function escapePowerShellSingleQuoted(text: string): string {
  return text.replace(/'/g, "''");
}

async function runPowerShellScript(script: string, cwd?: string): Promise<ExecResult> {
  return execFileAsync("pwsh", ["-NoProfile", "-Command", script], cwd);
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

async function sanitizeBuiltPackage(context: DataversePowerToolsContext, packagePath: string): Promise<void> {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dataverse-powertools-package-"));
  try {
    const escapedPackagePath = escapePowerShellSingleQuoted(packagePath);
    const escapedTempRoot = escapePowerShellSingleQuoted(tempRoot);
    await runPowerShellScript(`Expand-Archive -Path '${escapedPackagePath}' -DestinationPath '${escapedTempRoot}' -Force`);

    const forbiddenAssemblyNames = new Set(["microsoft.xrm.sdk.dll", "microsoft.crm.sdk.proxy.dll", "microsoft.xrm.sdk.workflow.dll"]);

    const extractedFiles = await walkDirectory(tempRoot);
    const removedFiles: string[] = [];
    for (const extractedFilePath of extractedFiles) {
      const fileName = path.basename(extractedFilePath).toLowerCase();
      if (!forbiddenAssemblyNames.has(fileName)) {
        continue;
      }

      await fs.promises.rm(extractedFilePath, { force: true });
      removedFiles.push(fileName);
    }

    if (removedFiles.length === 0) {
      return;
    }

    context.channel.appendLine(`Sanitizing package by removing forbidden SDK assemblies: ${Array.from(new Set(removedFiles)).join(", ")}.`);

    const escapedPackageWildcard = escapePowerShellSingleQuoted(path.join(tempRoot, "*"));
    await runPowerShellScript(
      `if (Test-Path '${escapedPackagePath}') { Remove-Item '${escapedPackagePath}' -Force }; ` +
        `Compress-Archive -Path '${escapedPackageWildcard}' -DestinationPath '${escapedPackagePath}' -Force`,
    );
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

async function findBuiltAssemblyPath(workspacePath: string, csprojPath: string): Promise<string | undefined> {
  const assemblyName = `${path.basename(csprojPath, ".csproj")}.dll`;
  const allFiles = await walkDirectory(workspacePath);
  const matchingFiles = allFiles.filter((filePath) => {
    if (path.basename(filePath).toLowerCase() !== assemblyName.toLowerCase()) {
      return false;
    }

    const relative = path.relative(workspacePath, filePath).toLowerCase();
    const segments = relative.split(path.sep);
    return segments.includes("bin") && !segments.includes("obj");
  });
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

async function findBuiltPackagePath(workspacePath: string, csprojPath: string, packedAfterMs: number, preferredPackageId?: string): Promise<string | undefined> {
  const allFiles = await walkDirectory(workspacePath);
  const allPackages = allFiles.filter((filePath) => {
    const relative = path.relative(workspacePath, filePath).toLowerCase();
    const segments = relative.split(path.sep);
    if (!segments.includes("bin") || segments.includes("obj")) {
      return false;
    }

    const fileName = path.basename(filePath).toLowerCase();
    if (!fileName.endsWith(".nupkg") || fileName.endsWith(".snupkg")) {
      return false;
    }

    if (fileName.includes(".tests.")) {
      return false;
    }

    return true;
  });

  if (allPackages.length === 0) {
    return undefined;
  }

  const packagePrefix = `${path.basename(csprojPath, ".csproj")}.`;
  const preferredPrefix = preferredPackageId ? `${preferredPackageId}.`.toLowerCase() : undefined;
  const packedAfterThreshold = packedAfterMs - 2000;

  const withStats = await Promise.all(
    allPackages.map(async (filePath) => ({
      filePath,
      fileNameLower: path.basename(filePath).toLowerCase(),
      mtimeMs: (await fs.promises.stat(filePath)).mtimeMs,
    })),
  );

  const currentRunPackages = withStats.filter((entry) => entry.mtimeMs >= packedAfterThreshold);

  if (preferredPrefix) {
    const preferredCurrent = currentRunPackages.filter((entry) => entry.fileNameLower.startsWith(preferredPrefix)).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (preferredCurrent) {
      return preferredCurrent.filePath;
    }
  }

  const projectCurrent = currentRunPackages.filter((entry) => entry.fileNameLower.startsWith(packagePrefix.toLowerCase())).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (projectCurrent) {
    return projectCurrent.filePath;
  }

  const latestCurrent = currentRunPackages.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (latestCurrent) {
    return latestCurrent.filePath;
  }

  if (preferredPrefix) {
    const preferredAny = withStats.filter((entry) => entry.fileNameLower.startsWith(preferredPrefix)).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (preferredAny) {
      return preferredAny.filePath;
    }
  }

  const projectAny = withStats.filter((entry) => entry.fileNameLower.startsWith(packagePrefix.toLowerCase())).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (projectAny) {
    return projectAny.filePath;
  }

  return withStats.sort((a, b) => b.mtimeMs - a.mtimeMs)[0].filePath;
}

function sanitizeUniqueNameSegment(value: string): string {
  return value
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeCustomizationPrefix(prefix: string | undefined): string {
  const sanitized = (prefix || "")
    .trim()
    .replace(/[^A-Za-z0-9]/g, "")
    .replace(/_+$/g, "");

  if (!sanitized) {
    return "dpt";
  }

  if (!/^[A-Za-z]/.test(sanitized)) {
    return `p${sanitized}`;
  }

  return sanitized;
}

function getPrefixedPackageId(context: DataversePowerToolsContext, csprojPath: string): string {
  const normalizedPrefix = normalizeCustomizationPrefix(context.projectSettings.prefix);
  const configuredName = sanitizeUniqueNameSegment(context.projectSettings.pluginPackageName || "");
  const projectName = configuredName || sanitizeUniqueNameSegment(path.basename(csprojPath, ".csproj")) || "Plugin";
  return `${normalizedPrefix}_${projectName}`;
}

function getConfiguredPluginPackageVersion(context: DataversePowerToolsContext): string {
  const configuredVersion = (context.projectSettings.pluginPackageVersion || "").trim();
  if (/^\d+(\.\d+){1,3}([\-+][0-9A-Za-z.-]+)?$/.test(configuredVersion)) {
    return configuredVersion;
  }

  return "1.0.0";
}

function buildPluginPackageUniqueName(context: DataversePowerToolsContext, packageName: string): string {
  const normalizedPrefix = normalizeCustomizationPrefix(context.projectSettings.prefix);
  const segment = sanitizeUniqueNameSegment(packageName);
  const baseSegment = segment.length > 0 ? segment : "pluginpackage";

  let uniqueName = /^[A-Za-z][A-Za-z0-9]*_/.test(baseSegment) ? baseSegment : `${normalizedPrefix}_${baseSegment}`;
  if (uniqueName.length > 128) {
    uniqueName = uniqueName.substring(0, 128);
  }

  return uniqueName;
}

function parsePackageMetadata(context: DataversePowerToolsContext, csprojPath: string, packagePath: string): PluginPackageMetadata {
  const packageFileName = path.basename(packagePath, ".nupkg");
  const match = packageFileName.match(/^(.+?)\.([0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?)$/);
  const fallbackName = path.basename(csprojPath, ".csproj");
  const fallbackVersion = getConfiguredPluginPackageVersion(context);

  if (match) {
    const packageName = match[1];
    const version = match[2];
    const uniqueName = buildPluginPackageUniqueName(context, packageName);
    return {
      name: packageName,
      uniqueName,
      version,
    };
  }

  const uniqueName = buildPluginPackageUniqueName(context, fallbackName);

  return {
    name: fallbackName,
    uniqueName,
    version: fallbackVersion,
  };
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
  const workflowActivities: WorkflowActivityRegistration[] = [];

  const regex = /\[CrmPluginRegistration\(([\s\S]*?)\)\][\s\S]*?public\s+class\s+(\w+)\s*:\s*([^\r\n\{]+)/g;
  let match = regex.exec(content);
  while (match) {
    const argsText = match[1];
    const className = match[2];
    const classInheritance = match[3] || "";
    const args = splitTopLevelArguments(argsText);

    const isWorkflow = argsText.includes('"WorkflowActivity"') || classInheritance.includes("WorkflowBase") || classInheritance.includes("CodeActivity");
    if (isWorkflow) {
      workflowActivities.push({
        className,
        fullTypeName: `${namespaceName}.${className}`,
        workflowName: getQuotedStringValue(args[1] || `"${className}"`),
        workflowDescription: getQuotedStringValue(args[2] || '""'),
        workflowGroup: getQuotedStringValue(args[3] || '""'),
      });
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

  return { pluginSteps, workflowActivities };
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
  const workflowActivities: WorkflowActivityRegistration[] = [];

  for (const filePath of sourceFiles) {
    const content = await fs.promises.readFile(filePath, "utf8");
    const parsed = parseDecorationsFromContent(content);
    pluginSteps.push(...parsed.pluginSteps);
    workflowActivities.push(...parsed.workflowActivities);
  }

  return { pluginSteps, workflowActivities };
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
      title: "Building package and deploying...",
    },
    async () => {
      const buildTarget = await findBuildTarget(workspacePath);
      const buildArgs = ["build"];
      if (buildTarget) {
        buildArgs.push(buildTarget);
      }

      context.channel.appendLine(`Build Package & Deploy started${buildTarget ? ` for ${buildTarget}` : ""}.`);

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

      const packArgs = ["pack"];
      if (buildTarget) {
        packArgs.push(buildTarget);
      }
      packArgs.push("--configuration", "Debug", "--no-build");

      const csprojPathForPack = await findPrimaryPluginCsproj(workspacePath, context.projectSettings.pluginProjectName);
      let expectedPackageId: string | undefined;
      if (csprojPathForPack) {
        const prefixedPackageId = getPrefixedPackageId(context, csprojPathForPack);
        const configuredPackageVersion = getConfiguredPluginPackageVersion(context);
        expectedPackageId = prefixedPackageId;
        packArgs.push(`-p:PackageId=${prefixedPackageId}`);
        packArgs.push(`-p:Version=${configuredPackageVersion}`);
        context.channel.appendLine(`Using PackageId override for pack: ${prefixedPackageId}`);
        context.channel.appendLine(`Using package Version override for pack: ${configuredPackageVersion}`);
      }

      const packStartedAt = Date.now();

      try {
        const packResult = await execFileAsync("dotnet", packArgs, workspacePath);
        if (packResult.stdout) {
          context.channel.appendLine(packResult.stdout);
        }
        if (packResult.stderr) {
          context.channel.appendLine(packResult.stderr);
        }
      } catch (error: any) {
        if (error?.stdout) {
          context.channel.appendLine(error.stdout);
        }
        if (error?.stderr) {
          context.channel.appendLine(error.stderr);
        }
        context.channel.appendLine("Package build failed; deployment skipped.");
        context.channel.show();
        vscode.window.showErrorMessage("Package build failed. See output for details.");
        return;
      }

      const csprojPath = await findPrimaryPluginCsproj(workspacePath, context.projectSettings.pluginProjectName);
      if (!csprojPath) {
        vscode.window.showErrorMessage("No plugin .csproj found in workspace.");
        return;
      }

      const assemblyPath = await findBuiltAssemblyPath(workspacePath, csprojPath);
      if (!assemblyPath) {
        vscode.window.showErrorMessage("Could not find built assembly DLL in bin output.");
        return;
      }

      const packagePath = await findBuiltPackagePath(workspacePath, csprojPath, packStartedAt, expectedPackageId);
      if (!packagePath) {
        context.channel.appendLine("Package path not detected after pack. Check dotnet output for package location.");
        vscode.window.showErrorMessage("Package build succeeded, but .nupkg path was not detected. See output for details.");
        return;
      }
      context.channel.appendLine(`Built package: ${packagePath}`);

      try {
        await sanitizeBuiltPackage(context, packagePath);
      } catch (error: any) {
        const message = error?.error?.message || error?.message || "Unknown package sanitization error";
        context.channel.appendLine(`Failed to sanitize package before upload: ${message}`);
        if (error?.stdout) {
          context.channel.appendLine(error.stdout);
        }
        if (error?.stderr) {
          context.channel.appendLine(error.stderr);
        }
        context.channel.show();
        vscode.window.showErrorMessage("Package sanitization failed. See output for details.");
        return;
      }

      const packageMetadata = parsePackageMetadata(context, csprojPath, packagePath);
      context.channel.appendLine(`Package metadata: Name='${packageMetadata.name}', UniqueName='${packageMetadata.uniqueName}', Version='${packageMetadata.version}'.`);
      const packageResolution = await upsertDataversePluginPackage(context, packageMetadata, packagePath);
      const pluginPackageId = packageResolution.pluginPackageId;
      if (!pluginPackageId) {
        context.channel.appendLine(`Unable to resolve or create Dataverse plugin package '${packageMetadata.uniqueName}'.`);
        vscode.window.showErrorMessage(`Build succeeded, but failed to resolve/create Dataverse plugin package '${packageMetadata.uniqueName}'. See output for details.`);
        return;
      }

      if (packageResolution.created) {
        context.channel.appendLine(`Created Dataverse plugin package '${packageMetadata.uniqueName}' (${pluginPackageId}).`);
      } else if (packageResolution.updated) {
        context.channel.appendLine(`Updated Dataverse plugin package '${packageMetadata.uniqueName}' (${pluginPackageId}).`);
      } else {
        context.channel.appendLine(`Resolved existing Dataverse plugin package '${packageMetadata.uniqueName}' (${pluginPackageId}).`);
      }

      const solutionUniqueName = context.projectSettings.solutionName;
      if (solutionUniqueName) {
        const packageSolutionAssociation = await addDataverseSolutionComponentByObjectId(context, solutionUniqueName, pluginPackageId);
        if (packageSolutionAssociation) {
          context.channel.appendLine(`Ensured plugin package '${packageMetadata.uniqueName}' is associated with solution '${solutionUniqueName}'.`);
        } else {
          context.channel.appendLine(`Could not associate plugin package '${packageMetadata.uniqueName}' with solution '${solutionUniqueName}'.`);
        }
      }

      const discovered = await discoverRegistrations(workspacePath);
      const pluginCount = discovered.pluginSteps.length;
      const workflowCount = discovered.workflowActivities.length;
      context.channel.appendLine(`Discovered ${pluginCount} plugin step decorations and ${workflowCount} workflow decorations.`);

      const assemblyName = path.basename(assemblyPath, ".dll");
      context.channel.appendLine(`Waiting for plugin assembly '${assemblyName}' to be available from package import...`);
      const assemblyId = await waitForDataversePluginAssemblyFromPackage(context, pluginPackageId, assemblyName);
      if (!assemblyId) {
        context.channel.appendLine(`Unable to resolve Dataverse plugin assembly '${assemblyName}' linked to package '${packageMetadata.uniqueName}'.`);
        vscode.window.showErrorMessage(`Package uploaded, but plugin assembly '${assemblyName}' was not available yet. Re-run deployment or check Dataverse import status.`);
        return;
      }

      context.channel.appendLine(`Resolved Dataverse plugin assembly '${assemblyName}' (${assemblyId}).`);
      const registrationResult = await registerPluginSteps(context, assemblyId, discovered.pluginSteps, context.projectSettings.solutionName);
      context.channel.appendLine(
        `Plugin step sync complete. Created: ${registrationResult.created}, Updated: ${registrationResult.updated}, Unchanged: ${registrationResult.unchanged}, Skipped: ${registrationResult.skipped}.`,
      );

      const workflowResult = await registerWorkflowActivities(context, assemblyId, discovered.workflowActivities, context.projectSettings.solutionName);
      context.channel.appendLine(
        `Workflow activity sync complete. Created: ${workflowResult.created}, Updated: ${workflowResult.updated}, Unchanged: ${workflowResult.unchanged}, Skipped: ${workflowResult.skipped}.`,
      );

      context.channel.appendLine("Publishing all customizations...");
      try {
        vscode.window.showInformationMessage("Publishing customizations...");
        await context.dataverse?.publishAllCustomisations();
        context.channel.appendLine("Publish all customizations completed.");
      } catch (publishError: any) {
        const message = publishError?.message || "Unknown publish error";
        context.channel.appendLine(`Publish all customizations failed: ${message}`);
      }

      context.channel.appendLine("Build Package & Deploy completed.");
      vscode.window.showInformationMessage(
        `Build Package & Deploy completed (Package ${packageResolution.created ? "created" : "updated"}, Steps: ${registrationResult.created} created, ${registrationResult.updated} updated, ${registrationResult.unchanged} unchanged, ${registrationResult.skipped} skipped, Workflows: ${workflowResult.created} created, ${workflowResult.updated} updated, ${workflowResult.unchanged} unchanged, ${workflowResult.skipped} skipped, package built).`,
      );
    },
  );
}
