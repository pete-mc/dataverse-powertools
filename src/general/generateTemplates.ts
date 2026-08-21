import * as vscode from "vscode";
import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes, TemplatePlaceholder } from "../context";
import path = require("path");
import fs = require("fs");
import * as cp from "child_process";
import { createServicePrincipalString, getProjectType } from "./connectionStringManager";
import { generalInitialise } from "./initialiseExtension";
import { restoreDependencies } from "./restoreDependencies";
import { getProjectTypeActivation } from "../projectTypes/activation";
import { getTemplateFolderForType } from "../projectTypes/registry";
import { addPrivateAssetsToWorkflowPackage, ensureReadmePackaging, defaultPluginReadme } from "../plugins/csprojTransforms";
import { ensureMultiTargetedPluginCsproj } from "../plugins/multiTarget";
import { activeComponentRoot } from "../components/componentDiscovery";
import { applyPlaceholders, applyProjectPlaceholders } from "./templateSubstitution";

function sanitizeProjectName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "Plugin";
  }

  const cleaned = trimmed.replace(/[^a-zA-Z0-9_.-]/g, "").replace(/\s+/g, "");
  if (!cleaned) {
    return "Plugin";
  }

  if (/^[0-9]/.test(cleaned)) {
    return `Plugin${cleaned}`;
  }

  return cleaned;
}

function sanitizeSolutionName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "Plugin";
  }

  const withoutInvalidChars = trimmed.replace(/[<>:"/\\|?*]/g, "").trim();
  if (!withoutInvalidChars) {
    return "Plugin";
  }

  return withoutInvalidChars;
}

function execFileAsync(file: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
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

function resolvePrimaryPluginCsprojInDirectory(projectDirectory: string, projectName: string): string | undefined {
  const preferredCsprojPath = path.join(projectDirectory, `${projectName}.csproj`);
  if (fs.existsSync(preferredCsprojPath)) {
    return preferredCsprojPath;
  }

  const legacyCsprojPath = path.join(projectDirectory, "Plugin.csproj");
  if (fs.existsSync(legacyCsprojPath)) {
    return legacyCsprojPath;
  }

  const candidate = fs
    .readdirSync(projectDirectory)
    .filter((entry) => entry.toLowerCase().endsWith(".csproj") && !entry.toLowerCase().endsWith(".tests.csproj"))
    .sort((a, b) => a.localeCompare(b))[0];

  return candidate ? path.join(projectDirectory, candidate) : undefined;
}

function normalizeGitignoreLines(content: string): string {
  const lines = content.split(/\r?\n/);
  const normalizedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed === "/bin" || trimmed === "bin" || trimmed === "bin/") {
      return "/**/bin";
    }

    if (trimmed === "/obj" || trimmed === "obj" || trimmed === "obj/") {
      return "/**/obj";
    }

    return line;
  });

  const hasRecursiveBin = normalizedLines.some((line) => line.trim() === "/**/bin");
  const hasRecursiveObj = normalizedLines.some((line) => line.trim() === "/**/obj");

  if (!hasRecursiveBin) {
    normalizedLines.push("/**/bin");
  }

  if (!hasRecursiveObj) {
    normalizedLines.push("/**/obj");
  }

  return `${normalizedLines.join("\n")}\n`;
}

function mergeGitignoreContent(rootContent: string, nestedContent: string): string {
  const rootLines = rootContent.split(/\r?\n/);
  const nestedLines = nestedContent.split(/\r?\n/);
  const existing = new Set(rootLines);

  for (const line of nestedLines) {
    if (existing.has(line)) {
      continue;
    }

    rootLines.push(line);
    existing.add(line);
  }

  return rootLines.join("\n");
}

async function normalizePluginV3Gitignore(context: DataversePowerToolsContext, workspacePath: string, projectDirectory: string): Promise<void> {
  const nestedGitignorePath = path.join(projectDirectory, ".gitignore");
  const rootGitignorePath = path.join(workspacePath, ".gitignore");

  if (!fs.existsSync(nestedGitignorePath) && !fs.existsSync(rootGitignorePath)) {
    return;
  }

  let rootContent = fs.existsSync(rootGitignorePath) ? await fs.promises.readFile(rootGitignorePath, "utf8") : "";

  if (fs.existsSync(nestedGitignorePath)) {
    const nestedContent = await fs.promises.readFile(nestedGitignorePath, "utf8");
    if (!rootContent) {
      rootContent = nestedContent;
      context.channel.appendLine("Moved plugin .gitignore content to workspace root.");
    } else {
      rootContent = mergeGitignoreContent(rootContent, nestedContent);
      context.channel.appendLine("Merged plugin .gitignore content into workspace root .gitignore.");
    }

    await fs.promises.rm(nestedGitignorePath, { force: true });
  }

  const normalized = normalizeGitignoreLines(rootContent);
  await fs.promises.writeFile(rootGitignorePath, normalized, "utf8");
  context.channel.appendLine("Normalized .gitignore to use recursive /bin and /obj ignores.");
}

async function ensurePluginV3Solution(context: DataversePowerToolsContext, workspacePath: string, pluginCsprojPath: string, projectName: string): Promise<void> {
  const solutionNameSource = context.projectSettings.pluginPackageName || projectName;
  const solutionName = sanitizeSolutionName(solutionNameSource);
  const rootSlnPath = path.join(workspacePath, `${solutionName}.sln`);
  const rootSlnxPath = path.join(workspacePath, `${solutionName}.slnx`);

  const nestedSlnFiles = fs.readdirSync(path.dirname(pluginCsprojPath)).filter((entry) => entry.toLowerCase().endsWith(".sln") || entry.toLowerCase().endsWith(".slnx"));

  for (const nestedSlnFile of nestedSlnFiles) {
    const nestedPath = path.join(path.dirname(pluginCsprojPath), nestedSlnFile);
    await fs.promises.rm(nestedPath, { force: true });
  }

  if (!fs.existsSync(rootSlnPath) && fs.existsSync(rootSlnxPath)) {
    await fs.promises.rm(rootSlnxPath, { force: true });
    context.channel.appendLine(`Removed unsupported solution format: ${solutionName}.slnx`);
  }

  if (!fs.existsSync(rootSlnPath)) {
    // `--format sln` forces the classic .sln (newer SDKs can emit .slnx), but that
    // option only exists on .NET SDK 9+; on SDK 8 `dotnet new sln --format sln` errors
    // with "'--format' is not a valid option". Try it, and fall back to the plain
    // command (which already defaults to .sln) on older SDKs.
    try {
      await execFileAsync("dotnet", ["new", "sln", "--name", solutionName, "--format", "sln"], workspacePath);
    } catch {
      await execFileAsync("dotnet", ["new", "sln", "--name", solutionName], workspacePath);
    }
    context.channel.appendLine(`Created solution file: ${solutionName}.sln`);
  }

  const slnContent = await fs.promises.readFile(rootSlnPath, "utf8");
  const normalizedRelativeCsprojPath = path.relative(workspacePath, pluginCsprojPath).replace(/\//g, "\\");
  if (!slnContent.includes(normalizedRelativeCsprojPath)) {
    await execFileAsync("dotnet", ["sln", rootSlnPath, "add", pluginCsprojPath], workspacePath);
    context.channel.appendLine(`Added project to solution: ${normalizedRelativeCsprojPath}`);
  }
}

async function promptPluginProjectName(context: DataversePowerToolsContext): Promise<void> {
  if (context.projectSettings.type !== ProjectTypes.plugin) {
    return;
  }

  const defaultName = context.projectSettings.pluginProjectName || "Plugin";
  const input = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: "What is the plugin project name?",
    value: defaultName,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Plugin project name is required.";
      }
      return undefined;
    },
  });

  context.projectSettings.pluginProjectName = sanitizeProjectName(input || defaultName);
}

export async function normalizePluginV3Layout(context: DataversePowerToolsContext): Promise<void> {
  if (!vscode.workspace.workspaceFolders || context.projectSettings.type !== ProjectTypes.plugin || context.projectSettings.templateversion !== 3) {
    return;
  }

  const workspacePath = activeComponentRoot(context) ?? vscode.workspace.workspaceFolders[0].uri.fsPath;
  const projectName = context.projectSettings.pluginProjectName || "Plugin";
  const projectDirectory = path.join(workspacePath, projectName);
  if (!fs.existsSync(projectDirectory)) {
    return;
  }

  await normalizePluginV3Gitignore(context, workspacePath, projectDirectory);

  const pluginCsprojPath = path.join(projectDirectory, "Plugin.csproj");
  const renamedCsprojPath = path.join(projectDirectory, `${projectName}.csproj`);
  if (fs.existsSync(pluginCsprojPath) && !fs.existsSync(renamedCsprojPath)) {
    await fs.promises.rename(pluginCsprojPath, renamedCsprojPath);
  }

  // `pac plugin init` scaffolds a sample Plugin1.cs — remove it: like web
  // resources, a new project starts empty and offers to create a real class.
  const samplePluginPath = path.join(projectDirectory, "Plugin1.cs");
  if (fs.existsSync(samplePluginPath)) {
    await fs.promises.rm(samplePluginPath, { force: true });
  }

  // Pack a README into the plugin NuGet package (suppresses the missing-readme
  // warning), keep Microsoft.CrmSdk.Workflow out of the package's dependency
  // graph (PrivateAssets — `dotnet add package` can't set it), and multi-target
  // net462;net8.0 so the project's TESTS can run without a .NET Framework test
  // host (#269 — the deployed assembly is still net462 alone).
  const readmePath = path.join(projectDirectory, "README.md");
  if (!fs.existsSync(readmePath)) {
    await fs.promises.writeFile(readmePath, defaultPluginReadme(projectName), "utf8");
  }
  if (fs.existsSync(renamedCsprojPath)) {
    const csproj = await fs.promises.readFile(renamedCsprojPath, "utf8");
    const patched = ensureMultiTargetedPluginCsproj(ensureReadmePackaging(addPrivateAssetsToWorkflowPackage(csproj)));
    if (patched !== csproj) {
      await fs.promises.writeFile(renamedCsprojPath, patched, "utf8");
    }
  }

  const rootTemplateFiles = ["WorkflowBase.cs", "CrmPluginRegistrationAttribute.generated.cs"];
  for (const fileName of rootTemplateFiles) {
    const sourcePath = path.join(workspacePath, fileName);
    const destinationPath = path.join(projectDirectory, fileName);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    if (!fs.existsSync(destinationPath)) {
      await fs.promises.rename(sourcePath, destinationPath);
    } else {
      await fs.promises.rm(sourcePath, { force: true });
    }
  }

  const workflowBasePath = path.join(projectDirectory, "WorkflowBase.cs");
  if (fs.existsSync(workflowBasePath)) {
    const workflowBase = await fs.promises.readFile(workflowBasePath, "utf8");
    const updatedWorkflowBase = workflowBase.replace(/namespace\s+Plugin\b/g, `namespace ${projectName}`);
    if (updatedWorkflowBase !== workflowBase) {
      await fs.promises.writeFile(workflowBasePath, updatedWorkflowBase, "utf8");
    }
  }

  const primaryPluginCsprojPath = resolvePrimaryPluginCsprojInDirectory(projectDirectory, projectName);
  if (!primaryPluginCsprojPath) {
    context.channel.appendLine("Could not determine plugin .csproj while normalizing plugin v3 layout.");
    return;
  }

  await ensurePluginV3Solution(context, workspacePath, primaryPluginCsprojPath, projectName);
}

async function promptPluginPackageName(context: DataversePowerToolsContext): Promise<void> {
  if (context.projectSettings.type !== ProjectTypes.plugin) {
    return;
  }

  const defaultName = context.projectSettings.pluginPackageName || "Plugin";
  const input = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: "What is the plugin package name?",
    value: defaultName,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Plugin package name is required.";
      }
      return undefined;
    },
  });

  context.projectSettings.pluginPackageName = (input || defaultName).trim();
}

function isLikelyNuGetVersion(value: string): boolean {
  return /^\d+(\.\d+){1,3}([\-+][0-9A-Za-z.-]+)?$/.test(value.trim());
}

async function promptPluginPackageVersion(context: DataversePowerToolsContext): Promise<void> {
  if (context.projectSettings.type !== ProjectTypes.plugin) {
    return;
  }

  const defaultVersion = context.projectSettings.pluginPackageVersion || "1.0.0";
  const input = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: "What is the plugin package version?",
    value: defaultVersion,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return "Plugin package version is required.";
      }

      if (!isLikelyNuGetVersion(value)) {
        return "Use a NuGet version like 1.0.0 or 1.0.0-beta.1";
      }

      return undefined;
    },
  });

  context.projectSettings.pluginPackageVersion = (input || defaultVersion).trim();
}

export async function createNewProject(context: DataversePowerToolsContext) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Creating new project...",
    },
    async () => {
      const pick = await getProjectType(context);
      // Dismissing the first wizard step cancels the wizard — previously the
      // flow carried on, prompting for auth and writing a TYPELESS settings
      // file (caught by the e2e when a focus flap closed the quick pick).
      if (pick === "cancelled") {
        context.channel.appendLine("Project creation cancelled — no project type selected.");
        return;
      }
      await createServicePrincipalString(context);
      if (pick === "empty") {
        // Connection-only root: no template, no restore — components arrive
        // via Add Component into subfolders.
        await context.writeSettings();
        await context.readSettings();
        await generalInitialise(context);
        context.refreshPanel?.();
        vscode.window.showInformationMessage("Workspace initialised — use ＋ Add Component to add plugin/web-resource/solution components.");
        return;
      }
      await promptPluginProjectName(context);
      await promptPluginPackageName(context);
      await promptPluginPackageVersion(context);
      await generateTemplates(context);
      await context.writeSettings();
      await context.readSettings();
      await restoreDependencies(context, true);
      await normalizePluginV3Layout(context);
      await restoreDependencies(context);

      const activation = getProjectTypeActivation(context.projectSettings.type);
      await activation?.onProjectScaffolded?.(context);
      await generalInitialise(context);
      await activation?.onProjectCreated?.(context);
      context.refreshPanel?.();
    },
  );
  vscode.window.showInformationMessage("Project created");
}

export async function generateTemplates(context: DataversePowerToolsContext, targetDir?: string) {
  //inital system checks
  if (!context.projectSettings.type || !context.projectSettings.templateversion || !vscode.workspace.workspaceFolders) {
    vscode.window.showErrorMessage(!vscode.workspace.workspaceFolders ? "No folder open" : "No template type selected");
    return;
  }
  const folderPath = targetDir ?? activeComponentRoot(context) ?? vscode.workspace.workspaceFolders[0].uri.fsPath;
  var templateFilePath = context.vscode.asAbsolutePath(path.join("templates", getTemplateFolderForType(context.projectSettings.type)!));
  const templateToCopy = JSON.parse(fs.readFileSync(path.join(templateFilePath, "template.json"), "utf8")).find(
    (t: PowertoolsTemplate) => t.version === context.projectSettings.templateversion,
  ) as PowertoolsTemplate;
  if (!templateToCopy) {
    vscode.window.showErrorMessage("Could not find matching template");
    return;
  }
  context.channel.appendLine("Generating template version: " + templateToCopy.version.toString());
  let placeholders = [] as TemplatePlaceholder[];
  if (templateToCopy.placeholders) {
    for (let i = 0; i < templateToCopy.placeholders.length; i++) {
      const p = templateToCopy.placeholders[i];
      if (p.placeholder === "SOLUTIONPREFIX" || p.placeholder === "SOLUTIONPLACEHOLDER") {
        continue;
      }
      const placeholderValue = (await vscode.window.showInputBox({ prompt: p.displayName })) || p.placeholder;
      placeholders.push({ placeholder: p.placeholder, value: placeholderValue });
    }
  }
  context.projectSettings.placeholders = placeholders;
  templateToCopy.files?.every(async (f) => {
    // Files marked scaffold:false are on-demand templates for the Create * commands
    // (class / sample.test), not project scaffolding — don't copy them into a new
    // project (they carry ClassName/TableName placeholders only those commands fill in).
    if (f.scaffold === false) {
      return true;
    }
    const extension = f.extension === ".tstemplate" ? ".ts" : f.extension; // This is done because the .ts files do not copy into the published extension thus we overwrite it when actually copying from extension into the code
    var data = fs.readFileSync(path.join(templateFilePath, f.filename + f.extension, f.version + f.extension), "utf8");
    data = applyProjectPlaceholders(data, context.projectSettings);
    const destPath = f.path;
    destPath.unshift(folderPath);
    if (context.projectSettings.type === ProjectTypes.plugin && context.projectSettings.templateversion === 3 && context.projectSettings.pluginProjectName) {
      destPath.push(context.projectSettings.pluginProjectName);
    }
    destPath.push(f.filename + extension);
    var destPathString = path.join(...destPath);
    data = applyPlaceholders(data, placeholders);
    destPathString = applyPlaceholders(destPathString, placeholders);
    await fs.promises.mkdir(path.dirname(destPathString), { recursive: true });
    await vscode.workspace.fs.writeFile(vscode.Uri.file(destPathString), Buffer.from(data, "utf8"));
    return true;
  });
  context.channel.appendLine("Template generation complete");
}

export async function createTemplatedFile(
  context: DataversePowerToolsContext,
  sourceFilename: string,
  destinationFileName: string,
  replacements?: TemplatePlaceholder[],
  openFile?: boolean,
) {
  if (context.projectSettings.type && context.projectSettings.templateversion && vscode.workspace.workspaceFolders) {
    var fullFilePath = context.vscode.asAbsolutePath(path.join("templates", getTemplateFolderForType(context.projectSettings.type)!));
    var templates = JSON.parse(fs.readFileSync(path.join(fullFilePath, "template.json"), "utf8")) as Array<PowertoolsTemplate>;
    var templateToCopy = {} as PowertoolsTemplate;
    for (const t of templates) {
      if (t.version === context.projectSettings.templateversion) {
        templateToCopy = t;
        break;
      }
    }
    if (templateToCopy) {
      if (templateToCopy !== undefined && templateToCopy.files !== undefined) {
        const pluginTemplate = templateToCopy.files.find((x) => x.filename === sourceFilename);
        if (pluginTemplate !== undefined) {
          var data = fs.readFileSync(
            path.join(fullFilePath, pluginTemplate.filename + pluginTemplate.extension, `${context.projectSettings.templateversion}${pluginTemplate.extension}`),
            "utf8",
          );
          if (vscode.workspace.workspaceFolders) {
            const folderPath = activeComponentRoot(context) ?? vscode.workspace.workspaceFolders[0].uri.fsPath;
            const destPath = pluginTemplate.path;
            destPath.unshift(folderPath);
            let fileExtension = pluginTemplate.extension;
            let fileName = pluginTemplate.filename;
            if (pluginTemplate.extension === ".tstemplate") {
              fileExtension = ".ts";
            }
            fileName = destinationFileName;
            data = applyPlaceholders(data, replacements);
            destPath.push(fileName + fileExtension);
            var destPathString = path.join(...destPath);
            data = applyPlaceholders(data, context.projectSettings.placeholders);
            destPathString = applyPlaceholders(destPathString, context.projectSettings.placeholders);
            await vscode.workspace.fs.writeFile(vscode.Uri.file(destPathString), Buffer.from(data, "utf8"));
            if (openFile) {
              vscode.workspace.openTextDocument(vscode.Uri.file(destPathString)).then((doc) => {
                vscode.window.showTextDocument(doc);
              });
            }
          }
        }
      }
    }
  }
}
