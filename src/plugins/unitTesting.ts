import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { findPrimaryPluginCsproj } from "./projectPaths";
import { activeComponentRoot } from "../components/componentDiscovery";
import {
  UnitTestFramework,
  normalizePathForSettings,
  getTemplateForFramework,
  sanitizeClassName,
  getTestBoilerplate,
  resolveCompatibleTestTargetFramework,
  tryParseCSharpLanguageVersion,
} from "./unitTestingLogic";
import {
  DEPLOY_TARGET_FRAMEWORK,
  MODERN_TARGET_FRAMEWORK,
  ensureMultiTargetedPluginCsproj,
  isTestProjectPinnedToFramework,
  parseTargetFrameworks,
  testTargetFrameworkForPlugin,
} from "./multiTarget";

const dataverseUnitTestPackage = "DataverseUnitTest";

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

async function getWorkspacePath(context: DataversePowerToolsContext): Promise<string | undefined> {
  return activeComponentRoot(context);
}

async function runDotnet(context: DataversePowerToolsContext, args: string[], cwd: string): Promise<boolean> {
  try {
    const result = await execFileAsync("dotnet", args, cwd);
    if (result.stdout) {
      context.channel.appendLine(result.stdout);
    }
    if (result.stderr) {
      context.channel.appendLine(result.stderr);
    }
    return true;
  } catch (error: any) {
    if (error?.stdout) {
      context.channel.appendLine(error.stdout);
    }
    if (error?.stderr) {
      context.channel.appendLine(error.stderr);
    }
    context.channel.appendLine(error?.error?.message || error?.message || JSON.stringify(error));
    return false;
  }
}

export async function resolveTestProjectPath(context: DataversePowerToolsContext, workspacePath: string): Promise<string | undefined> {
  const configuredPath = context.projectSettings.pluginUnitTestingProject;
  if (configuredPath) {
    const absolute = path.join(workspacePath, configuredPath);
    if (fs.existsSync(absolute)) {
      return absolute;
    }
  }

  const entries = await fs.promises.readdir(workspacePath, { withFileTypes: true });
  const candidateDir = entries
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().endsWith(".tests"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))[0];

  if (!candidateDir) {
    return undefined;
  }

  const testCsproj = path.join(workspacePath, candidateDir, `${candidateDir}.csproj`);
  return fs.existsSync(testCsproj) ? testCsproj : undefined;
}

async function promptFramework(context: DataversePowerToolsContext): Promise<UnitTestFramework | undefined> {
  const current = (context.projectSettings.pluginUnitTestingFramework || "xunit") as UnitTestFramework;
  const picked = await vscode.window.showQuickPick(
    [
      { label: "MsTest", target: "mstest" as UnitTestFramework, description: current === "mstest" ? "Current" : undefined },
      { label: "xUnit", target: "xunit" as UnitTestFramework, description: current === "xunit" ? "Current" : undefined },
      { label: "NUnit", target: "nunit" as UnitTestFramework, description: current === "nunit" ? "Current" : undefined },
    ],
    {
      placeHolder: "Select unit test framework",
      ignoreFocusOut: true,
    },
  );

  return picked?.target;
}

async function addOrUpdateBoilerplate(
  context: DataversePowerToolsContext,
  framework: UnitTestFramework,
  testProjectDir: string,
  testProjectName: string,
  className = "PluginBoilerplateTests",
): Promise<void> {
  const namespaceName = testProjectName.replace(/[^A-Za-z0-9_.]/g, "_");
  const testFilePath = path.join(testProjectDir, `${className}.cs`);
  if (fs.existsSync(testFilePath)) {
    return;
  }

  const content = getTestBoilerplate(framework, namespaceName, className);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(testFilePath), Buffer.from(content, "utf8"));
  context.channel.appendLine(`Created unit test boilerplate: ${className}.cs`);
}

async function ensureTestProjectLanguageCompatibility(context: DataversePowerToolsContext, testCsprojPath: string): Promise<void> {
  const testContent = await fs.promises.readFile(testCsprojPath, "utf8");
  const nullableMatch = testContent.match(/<Nullable>\s*([^<]+)\s*<\/Nullable>/i);
  const nullableValue = (nullableMatch?.[1] || "").trim().toLowerCase();
  if (nullableValue !== "enable") {
    return;
  }

  const langVersionMatch = testContent.match(/<LangVersion>\s*([^<]+)\s*<\/LangVersion>/i);
  if (!langVersionMatch) {
    const withLangVersion = testContent.replace(/<Nullable>\s*enable\s*<\/Nullable>/i, `<Nullable>enable</Nullable>\n    <LangVersion>latest</LangVersion>`);
    if (withLangVersion !== testContent) {
      await fs.promises.writeFile(testCsprojPath, withLangVersion, "utf8");
      context.channel.appendLine("Added LangVersion latest to test project for template compatibility.");
    }
    return;
  }

  const currentLangVersion = (langVersionMatch[1] || "").trim();
  const parsedLangVersion = tryParseCSharpLanguageVersion(currentLangVersion);
  if (parsedLangVersion !== undefined && parsedLangVersion < 100) {
    const updated = testContent.replace(/<LangVersion>\s*([^<]+)\s*<\/LangVersion>/i, `<LangVersion>latest</LangVersion>`);
    if (updated !== testContent) {
      await fs.promises.writeFile(testCsprojPath, updated, "utf8");
      context.channel.appendLine(`Updated test project LangVersion to latest (was ${currentLangVersion}).`);
    }
  }
}

/**
 * Multi-target the plug-in project (net462;net8.0) so its tests can target a framework with a
 * runnable test host on any OS (#269). Without this the test project inherits net4x and
 * `dotnet test` needs mono off Windows. Idempotent; only writes when it changes something.
 */
async function ensurePluginProjectIsTestable(context: DataversePowerToolsContext, pluginCsprojPath: string, testCsprojPath: string): Promise<void> {
  // A test project pinned to .NET Framework by its own references (FakeXrmEasy.9 in the legacy
  // template-v2 scaffold, Microsoft.CrmSdk.*) can't move to net8.0 — so multi-targeting the
  // plug-in for its benefit would be churn that buys nothing. Leave both alone; a project that
  // tests fine on Windows today keeps doing so.
  if (fs.existsSync(testCsprojPath) && isTestProjectPinnedToFramework(await fs.promises.readFile(testCsprojPath, "utf8"))) {
    return;
  }

  const pluginContent = await fs.promises.readFile(pluginCsprojPath, "utf8");
  const multiTargeted = ensureMultiTargetedPluginCsproj(pluginContent);
  if (multiTargeted === pluginContent) {
    return;
  }
  await fs.promises.writeFile(pluginCsprojPath, multiTargeted, "utf8");
  context.channel.appendLine(
    `Multi-targeted ${path.basename(pluginCsprojPath)} as ${DEPLOY_TARGET_FRAMEWORK};${MODERN_TARGET_FRAMEWORK} so its tests run without a .NET Framework test host. ` +
      `The deployed assembly is still ${DEPLOY_TARGET_FRAMEWORK} only.`,
  );
}

async function ensureTestProjectTargetFramework(context: DataversePowerToolsContext, pluginCsprojPath: string, testCsprojPath: string): Promise<void> {
  const pluginContent = await fs.promises.readFile(pluginCsprojPath, "utf8");
  const pluginTargetFramework = parseTargetFrameworks(pluginContent)[0];
  if (!pluginTargetFramework) {
    return;
  }

  const testContent = await fs.promises.readFile(testCsprojPath, "utf8");
  // Same guard as ensurePluginProjectIsTestable: never retarget a test project its own references
  // pin to .NET Framework, even if the plug-in happens to multi-target.
  const compatibleTestTargetFramework = isTestProjectPinnedToFramework(testContent)
    ? resolveCompatibleTestTargetFramework(pluginTargetFramework)
    : (testTargetFrameworkForPlugin(pluginContent, resolveCompatibleTestTargetFramework) ?? pluginTargetFramework);

  if (!/<TargetFramework>\s*([^<]+)\s*<\/TargetFramework>/i.test(testContent)) {
    return;
  }

  const updated = testContent.replace(/<TargetFramework>\s*([^<]+)\s*<\/TargetFramework>/i, `<TargetFramework>${compatibleTestTargetFramework}</TargetFramework>`);
  if (updated !== testContent) {
    await fs.promises.writeFile(testCsprojPath, updated, "utf8");
    if (compatibleTestTargetFramework === MODERN_TARGET_FRAMEWORK) {
      context.channel.appendLine(
        `Updated test project target framework to ${compatibleTestTargetFramework} — the plug-in multi-targets, so the tests run without a .NET Framework test host (#269).`,
      );
    } else if (compatibleTestTargetFramework !== pluginTargetFramework) {
      context.channel.appendLine(
        `Updated test project target framework to ${compatibleTestTargetFramework} (plugin target ${pluginTargetFramework} is below DataverseUnitTest minimum).`,
      );
    } else {
      context.channel.appendLine(`Updated test project target framework to ${compatibleTestTargetFramework}.`);
    }
  }
}

async function ensureProjectReference(context: DataversePowerToolsContext, workspacePath: string, testCsprojPath: string, pluginCsprojPath: string): Promise<boolean> {
  const testCsprojContent = await fs.promises.readFile(testCsprojPath, "utf8");
  const pluginFileName = path.basename(pluginCsprojPath);
  if (testCsprojContent.includes(pluginFileName)) {
    return true;
  }

  return runDotnet(context, ["add", testCsprojPath, "reference", pluginCsprojPath], workspacePath);
}

async function ensureDataverseUnitTestPackage(context: DataversePowerToolsContext, workspacePath: string, testCsprojPath: string): Promise<boolean> {
  const testCsprojContent = await fs.promises.readFile(testCsprojPath, "utf8");
  if (new RegExp(`<PackageReference[^>]*(Include|Update)=\"${dataverseUnitTestPackage}\"`, "i").test(testCsprojContent)) {
    return true;
  }

  return runDotnet(context, ["add", testCsprojPath, "package", dataverseUnitTestPackage], workspacePath);
}

export async function setupPluginUnitTesting(context: DataversePowerToolsContext, selectedFramework?: UnitTestFramework): Promise<boolean> {
  const workspacePath = await getWorkspacePath(context);
  if (!workspacePath) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return false;
  }

  const pluginCsprojPath = await findPrimaryPluginCsproj(workspacePath, context.projectSettings.pluginProjectName);
  if (!pluginCsprojPath) {
    vscode.window.showErrorMessage("No plugin .csproj found in workspace.");
    return false;
  }

  const framework = selectedFramework || (await promptFramework(context));
  if (!framework) {
    return false;
  }

  const pluginProjectName = path.basename(pluginCsprojPath, ".csproj");
  const testProjectName = `${pluginProjectName}.Tests`;
  const testProjectDir = path.join(workspacePath, testProjectName);
  const testCsprojPath = path.join(testProjectDir, `${testProjectName}.csproj`);

  const created = !fs.existsSync(testCsprojPath);
  if (created) {
    const template = getTemplateForFramework(framework);
    const createdOk = await runDotnet(context, ["new", template, "--name", testProjectName, "--output", testProjectDir], workspacePath);
    if (!createdOk) {
      vscode.window.showErrorMessage("Failed to create test project. See output for details.");
      return false;
    }
  }

  // Order matters: the plug-in must multi-target BEFORE the test project's framework is
  // resolved from it, or the tests inherit net4x and can only run on Windows (#269).
  await ensurePluginProjectIsTestable(context, pluginCsprojPath, testCsprojPath);
  await ensureTestProjectTargetFramework(context, pluginCsprojPath, testCsprojPath);
  await ensureTestProjectLanguageCompatibility(context, testCsprojPath);

  const referenceOk = await ensureProjectReference(context, workspacePath, testCsprojPath, pluginCsprojPath);
  if (!referenceOk) {
    vscode.window.showErrorMessage("Failed to add plugin project reference to test project.");
    return false;
  }

  const packageOk = await ensureDataverseUnitTestPackage(context, workspacePath, testCsprojPath);
  if (!packageOk) {
    vscode.window.showErrorMessage("Failed to install DataverseUnitTest package in test project.");
    return false;
  }

  await addOrUpdateBoilerplate(context, framework, testProjectDir, testProjectName);

  context.projectSettings.pluginUnitTestingEnabled = true;
  context.projectSettings.pluginUnitTestingFramework = framework;
  context.projectSettings.pluginUnitTestingProject = normalizePathForSettings(path.relative(workspacePath, testCsprojPath));
  await context.writeSettings();
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasPluginUnitTesting", true);
  context.refreshPanel?.();

  vscode.window.showInformationMessage(`Unit testing is configured using ${framework.toUpperCase()} in ${testProjectName}.`);
  return true;
}

export async function promptAndSetupPluginUnitTesting(context: DataversePowerToolsContext): Promise<boolean> {
  const choice = await vscode.window.showQuickPick(["Yes", "No"], {
    placeHolder: "Would you like to set up unit testing for this plugin project?",
    ignoreFocusOut: true,
  });

  if (choice !== "Yes") {
    return false;
  }

  return setupPluginUnitTesting(context);
}

export async function runPluginUnitTests(context: DataversePowerToolsContext): Promise<void> {
  const workspacePath = await getWorkspacePath(context);
  if (!workspacePath) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  const testCsprojPath = await resolveTestProjectPath(context, workspacePath);
  if (!testCsprojPath) {
    vscode.window.showWarningMessage("No plugin test project found. Run Setup Unit Testing first.");
    return;
  }

  const pluginCsprojPath = await findPrimaryPluginCsproj(workspacePath, context.projectSettings.pluginProjectName);
  if (pluginCsprojPath) {
    await ensurePluginProjectIsTestable(context, pluginCsprojPath, testCsprojPath);
    await ensureTestProjectTargetFramework(context, pluginCsprojPath, testCsprojPath);
  }
  await ensureTestProjectLanguageCompatibility(context, testCsprojPath);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Running plugin unit tests...",
    },
    async () => {
      const success = await runDotnet(context, ["test", testCsprojPath], workspacePath);
      context.channel.show();
      if (success) {
        vscode.window.showInformationMessage("Plugin unit tests completed.");
      } else {
        vscode.window.showErrorMessage("Plugin unit tests failed. See output for details.");
      }
    },
  );
}

function resolveTestTargetDirectory(targetUri: vscode.Uri | undefined, fallbackDirectory: string): string {
  if (!targetUri) {
    return fallbackDirectory;
  }

  if (fs.existsSync(targetUri.fsPath) && fs.statSync(targetUri.fsPath).isDirectory()) {
    return targetUri.fsPath;
  }

  return path.dirname(targetUri.fsPath);
}

export async function createPluginTest(context: DataversePowerToolsContext, targetUri?: vscode.Uri): Promise<void> {
  const workspacePath = await getWorkspacePath(context);
  if (!workspacePath) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  const testCsprojPath = await resolveTestProjectPath(context, workspacePath);
  if (!testCsprojPath) {
    vscode.window.showWarningMessage("No plugin test project found. Run Setup Unit Testing first.");
    return;
  }

  const framework = (context.projectSettings.pluginUnitTestingFramework || "xunit") as UnitTestFramework;
  const testProjectDir = path.dirname(testCsprojPath);
  const testProjectName = path.basename(testCsprojPath, ".csproj");
  const destinationDirectory = resolveTestTargetDirectory(targetUri, testProjectDir);

  const nameInput = await vscode.window.showInputBox({ prompt: "Enter the test class name", value: "NewPluginTests" });
  if (!nameInput) {
    return;
  }

  const className = sanitizeClassName(nameInput);
  if (!className) {
    vscode.window.showErrorMessage("Invalid test class name.");
    return;
  }

  const destinationPath = path.join(destinationDirectory, `${className}.cs`);
  if (fs.existsSync(destinationPath)) {
    vscode.window.showWarningMessage(`A file named ${className}.cs already exists.`);
    return;
  }

  const namespaceName = testProjectName.replace(/[^A-Za-z0-9_.]/g, "_");
  const content = getTestBoilerplate(framework, namespaceName, className);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(destinationPath), Buffer.from(content, "utf8"));
  context.channel.appendLine(`Created plugin test: ${destinationPath}`);

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(destinationPath));
  await vscode.window.showTextDocument(document);
}
