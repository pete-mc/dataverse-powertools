import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";

const requiredWorkflowPackage = "Microsoft.CrmSdk.Workflow";
const fallbackWorkflowPackage = "Microsoft.CrmSdk.CoreAssemblies";
const requiredNetFrameworkSupportPackage = "Microsoft.NETFramework.ReferenceAssemblies";

interface ExecResult {
  stdout: string;
  stderr: string;
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

function sanitizeClassName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  const cleaned = trimmed.replace(/[^a-zA-Z0-9_]/g, "");
  if (!cleaned) {
    return "";
  }

  if (/^[0-9]/.test(cleaned)) {
    return `Class${cleaned}`;
  }

  return cleaned;
}

async function getWorkspacePath(): Promise<string | undefined> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return undefined;
  }

  return vscode.workspace.workspaceFolders[0].uri.fsPath;
}

async function detectNamespace(workspacePath: string): Promise<string> {
  const entries = await fs.promises.readdir(workspacePath, { withFileTypes: true });
  const csFiles = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".cs")).map((entry) => entry.name);

  const preferredFiles = ["PluginBase.cs", "WorkflowBase.cs", ...csFiles];
  for (const fileName of preferredFiles) {
    const filePath = path.join(workspacePath, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = await fs.promises.readFile(filePath, "utf8");
    const namespaceMatch = content.match(/namespace\s+([A-Za-z0-9_.]+)/);
    if (namespaceMatch && namespaceMatch[1]) {
      return namespaceMatch[1];
    }
  }

  return "Plugin";
}

async function readTemplate(context: DataversePowerToolsContext, relativePath: string): Promise<string> {
  const absolutePath = context.vscode.asAbsolutePath(relativePath);
  return fs.promises.readFile(absolutePath, "utf8");
}

async function writeClassFile(workspacePath: string, fileName: string, content: string): Promise<string | undefined> {
  const destinationPath = path.join(workspacePath, `${fileName}.cs`);
  if (fs.existsSync(destinationPath)) {
    return undefined;
  }

  await vscode.workspace.fs.writeFile(vscode.Uri.file(destinationPath), Buffer.from(content, "utf8"));
  return destinationPath;
}

async function openFile(filePath: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(document);
}

async function findPrimaryCsproj(workspacePath: string): Promise<string | undefined> {
  const entries = await fs.promises.readdir(workspacePath, { withFileTypes: true });
  const csprojFile = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csproj"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))[0];

  if (!csprojFile) {
    return undefined;
  }

  return path.join(workspacePath, csprojFile);
}

function hasPackageReference(csprojContent: string, packageName: string): boolean {
  const escapedPackageName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attributeReferenceRegex = new RegExp(`<PackageReference[^>]*(Include|Update)\\s*=\\s*["']${escapedPackageName}["'][^>]*>`, "i");
  const nestedReferenceRegex = new RegExp(`<PackageReference\\s*>[\\s\\S]*?<(Include|Update)>\\s*${escapedPackageName}\\s*</(Include|Update)>[\\s\\S]*?</PackageReference>`, "i");

  return attributeReferenceRegex.test(csprojContent) || nestedReferenceRegex.test(csprojContent);
}

async function ensureWorkflowPackages(context: DataversePowerToolsContext, workspacePath: string): Promise<void> {
  const csprojPath = await findPrimaryCsproj(workspacePath);
  if (!csprojPath) {
    context.channel.appendLine("Workflow package check skipped: no .csproj found in workspace root.");
    return;
  }

  const csprojContent = await fs.promises.readFile(csprojPath, "utf8");
  const missingPackages: string[] = [];

  const hasWorkflowPackage = hasPackageReference(csprojContent, requiredWorkflowPackage);
  const hasFallbackWorkflowPackage = hasPackageReference(csprojContent, fallbackWorkflowPackage);

  if (!hasWorkflowPackage) {
    missingPackages.push(requiredWorkflowPackage);
    if (hasFallbackWorkflowPackage) {
      context.channel.appendLine(`Workflow package ${requiredWorkflowPackage} not found. ${fallbackWorkflowPackage} is present but workflow package install is recommended.`);
    }
  }

  const targetFrameworkMatch = csprojContent.match(/<TargetFramework>\s*([^<]+)\s*<\/TargetFramework>/i);
  const targetFrameworkValue = targetFrameworkMatch?.[1]?.trim().toLowerCase();
  const isNetFrameworkProject = !!targetFrameworkValue && /^net[1-4]/.test(targetFrameworkValue);

  if (isNetFrameworkProject && !hasPackageReference(csprojContent, requiredNetFrameworkSupportPackage)) {
    missingPackages.push(requiredNetFrameworkSupportPackage);
  }

  if (missingPackages.length === 0) {
    return;
  }

  const installChoice = await vscode.window.showInformationMessage(
    `Workflow classes need Dataverse workflow dependencies. Missing: ${missingPackages.join(", ")}. Install now?`,
    { modal: true },
    "Install",
    "Skip",
  );

  if (installChoice !== "Install") {
    context.channel.appendLine(`Skipped package install. Missing workflow packages: ${missingPackages.join(", ")}`);
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Installing workflow NuGet packages...",
    },
    async () => {
      for (const packageName of missingPackages) {
        try {
          const { stdout, stderr } = await execFileAsync("dotnet", ["add", csprojPath, "package", packageName], workspacePath);
          if (stdout) {
            context.channel.appendLine(stdout);
          }
          if (stderr) {
            context.channel.appendLine(stderr);
          }
          context.channel.appendLine(`Installed NuGet package: ${packageName}`);
        } catch (error: any) {
          if (error?.stdout) {
            context.channel.appendLine(error.stdout);
          }
          if (error?.stderr) {
            context.channel.appendLine(error.stderr);
          }
          const message = error?.error?.message || error?.message || `Unknown error while installing ${packageName}`;
          context.channel.appendLine(`Failed to install ${packageName}: ${message}`);
          context.channel.show();
          vscode.window.showErrorMessage(`Failed to install ${packageName}. See output for details.`);
          return;
        }
      }

      vscode.window.showInformationMessage("Workflow NuGet dependencies installed.");
    },
  );
}

export async function createPluginClass(context: DataversePowerToolsContext): Promise<void> {
  const workspacePath = await getWorkspacePath();
  if (!workspacePath) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  const nameInput = await vscode.window.showInputBox({ prompt: "Enter the plugin class name" });
  if (!nameInput) {
    return;
  }

  const className = sanitizeClassName(nameInput);
  if (!className) {
    vscode.window.showErrorMessage("Invalid class name.");
    return;
  }

  const namespaceName = await detectNamespace(workspacePath);
  let template = await readTemplate(context, path.join("templates", "plugin", "pluginClassV3.cs", "1.cs"));
  template = template.replace(/NAMESPACEPLACEHOLDER/g, namespaceName).replace(/CLASSNAMEPLACEHOLDER/g, className);

  const destination = await writeClassFile(workspacePath, className, template);
  if (!destination) {
    vscode.window.showWarningMessage(`A file named ${className}.cs already exists.`);
    return;
  }

  context.channel.appendLine(`Created plugin class: ${className}.cs`);
  await openFile(destination);
}

async function ensureWorkflowBase(context: DataversePowerToolsContext, workspacePath: string, namespaceName: string): Promise<void> {
  const workflowBasePath = path.join(workspacePath, "WorkflowBase.cs");
  if (fs.existsSync(workflowBasePath)) {
    return;
  }

  let template = await readTemplate(context, path.join("templates", "plugin", "workflowBaseV3.cs", "1.cs"));
  template = template.replace(/NAMESPACEPLACEHOLDER/g, namespaceName);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(workflowBasePath), Buffer.from(template, "utf8"));
  context.channel.appendLine("Created workflow base class: WorkflowBase.cs");
}

export async function createWorkflowClass(context: DataversePowerToolsContext): Promise<void> {
  const workspacePath = await getWorkspacePath();
  if (!workspacePath) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  const nameInput = await vscode.window.showInputBox({ prompt: "Enter the workflow class name" });
  if (!nameInput) {
    return;
  }

  const className = sanitizeClassName(nameInput);
  if (!className) {
    vscode.window.showErrorMessage("Invalid class name.");
    return;
  }

  const namespaceName = await detectNamespace(workspacePath);
  await ensureWorkflowPackages(context, workspacePath);
  await ensureWorkflowBase(context, workspacePath, namespaceName);

  let template = await readTemplate(context, path.join("templates", "plugin", "workflowClassV3.cs", "1.cs"));
  template = template.replace(/NAMESPACEPLACEHOLDER/g, namespaceName).replace(/WORKFLOWCLASSNAMEPLACEHOLDER/g, className);

  const destination = await writeClassFile(workspacePath, className, template);
  if (!destination) {
    vscode.window.showWarningMessage(`A file named ${className}.cs already exists.`);
    return;
  }

  context.channel.appendLine(`Created workflow class: ${className}.cs`);
  await openFile(destination);
}
