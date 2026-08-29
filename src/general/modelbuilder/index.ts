import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../../context";
import { runPac } from "./commandRunner";
import { ensurePacAuthForCurrentConnection, isPacAuthError, pacOutputHasError, reestablishPacAuthForCurrentConnection } from "../pacAuth";
import {
  applyDefaults,
  ensurePluginModelBuilderSettingsLoaded,
  getModelBuilderFilePath,
  getWorkspacePath,
  readModelBuilderSettingsFile,
  saveModelBuilderSettingsFile,
} from "./settingsFile";
import { configureEditableSettings, editSingleSetting, ModelBuilderSettingKey } from "./ui";
import { activeComponentRoot } from "../../components/componentDiscovery";
import { buildModelBuilderArgs } from "./args";

/** Run pac; if it fails with a pac AUTH error, re-establish the extension's pac
 * profile and retry ONCE before giving up. runPac (commandRunner) rejects with
 * { error, stdout, stderr } on failure, so we inspect that payload. Non-auth
 * failures re-throw unchanged for the caller's existing error handling. */
async function runPacWithAuthRetry(context: DataversePowerToolsContext, args: string[], workspacePath: string): Promise<{ stdout: string; stderr: string }> {
  // pac usually exits 0 EVEN WHEN IT FAILS (e.g. "Error: No profiles were found" with code 0),
  // so runPac won't throw — detect failure from the OUTPUT. Normalise a genuine throw into the
  // same shape so both are handled the same way.
  const run = async (): Promise<{ stdout: string; stderr: string }> => {
    try {
      return await runPac(args, workspacePath);
    } catch (error: any) {
      return { stdout: error?.stdout ?? "", stderr: `Error: ${error?.error?.message ?? error?.message ?? "pac command failed"}\n${error?.stderr ?? ""}` };
    }
  };
  let result = await run();
  let combined = `${result.stdout}\n${result.stderr}`;
  if (pacOutputHasError(combined) && isPacAuthError(combined)) {
    context.channel.appendLine("[pac] Authentication error — re-establishing the pac profile and retrying once.");
    if (await reestablishPacAuthForCurrentConnection(context, workspacePath)) {
      result = await run();
      combined = `${result.stdout}\n${result.stderr}`;
    }
  }
  // Still failing → THROW so the caller reports the error instead of a false "generation complete".
  if (pacOutputHasError(combined)) {
    throw new Error(`pac reported an error: ${(result.stderr || result.stdout).replace(/\s+/g, " ").trim().slice(0, 300)}`);
  }
  return result;
}

async function createSettingsTemplateFile(context: DataversePowerToolsContext, namespace: string, serviceContextName: string, outputDirectory: string): Promise<void> {
  const workspacePath = getWorkspacePath(context);
  if (!workspacePath) {
    return;
  }

  const outputPath = path.join(workspacePath, outputDirectory);
  const existingJsonFiles = new Set<string>();
  if (fs.existsSync(outputPath)) {
    for (const file of await fs.promises.readdir(outputPath)) {
      if (file.toLowerCase().endsWith(".json")) {
        existingJsonFiles.add(file.toLowerCase());
      }
    }
  }

  const settingsFilePath = getModelBuilderFilePath(context);
  if (!settingsFilePath) {
    return;
  }

  const args = ["modelbuilder", "build", "--namespace", namespace, "--serviceContextName", serviceContextName, "--outdirectory", outputDirectory, "--writesettingsTemplateFile"];

  const { stdout, stderr } = await runPac(args, workspacePath);
  if (stdout) {
    context.channel.appendLine(stdout);
  }
  if (stderr) {
    context.channel.appendLine(stderr);
  }

  // pac failing (e.g. no auth) can leave the output directory uncreated — turn
  // that into the clear caught-and-logged error, not a raw ENOENT scandir (#103).
  if (!fs.existsSync(outputPath)) {
    throw new Error(`pac modelbuilder produced no output in ${outputPath} — see the pac output above.`);
  }

  const generatedJsonFiles = (await fs.promises.readdir(outputPath))
    .filter((file) => file.toLowerCase().endsWith(".json"))
    .filter((file) => !existingJsonFiles.has(file.toLowerCase()));

  const generatedSettingsFile =
    generatedJsonFiles.find((file) => file.toLowerCase().includes("setting")) ||
    generatedJsonFiles.find((file) => file.toLowerCase().includes("modelbuilder")) ||
    generatedJsonFiles[0];

  if (!generatedSettingsFile) {
    throw new Error(`Could not find generated settings template json in ${outputPath}.`);
  }

  await fs.promises.copyFile(path.join(outputPath, generatedSettingsFile), settingsFilePath);
}

export async function updatePluginModelBuilderSettingsContext(context: DataversePowerToolsContext) {
  const settings = context.projectSettings.pluginModelBuilder;
  const hasSettings = !!settings?.namespace && !!settings?.serviceContextName && !!settings?.outputDirectory;
  await vscode.commands.executeCommand("setContext", "dataverse-powertools.hasPluginModelBuilderSettings", hasSettings);
}

export async function loadPluginModelBuilderSettings(context: DataversePowerToolsContext) {
  await ensurePluginModelBuilderSettingsLoaded(context);
  await updatePluginModelBuilderSettingsContext(context);
}

export async function configureModelBuilderSettings(context: DataversePowerToolsContext) {
  await loadPluginModelBuilderSettings(context);

  const existing = applyDefaults(context.projectSettings.pluginModelBuilder || {});
  const namespacePlaceholder = context.projectSettings.placeholders?.find((placeholder) => placeholder.placeholder === "PROJECTNAMESPACE")?.value;

  let baseSettings = existing;
  if (!context.projectSettings.pluginModelBuilder?.namespace || !context.projectSettings.pluginModelBuilder?.serviceContextName) {
    const modelNamespace = await vscode.window.showInputBox({
      title: "Plugin Model Builder Initial Setup",
      prompt: "Class namespace for generated early-bound files",
      value: existing.namespace || namespacePlaceholder || "Dataverse.Plugins",
      ignoreFocusOut: true,
    });
    if (!modelNamespace) {
      return;
    }

    const serviceContextName = await vscode.window.showInputBox({
      title: "Plugin Model Builder Initial Setup",
      prompt: "Service context class name",
      value: existing.serviceContextName || "XrmSvc",
      ignoreFocusOut: true,
    });
    if (!serviceContextName) {
      return;
    }

    const outputDirectory = await vscode.window.showInputBox({
      title: "Plugin Model Builder Initial Setup",
      prompt: "Output directory for generated files (relative to workspace)",
      value: existing.outputDirectory || "generated",
      ignoreFocusOut: true,
    });
    if (!outputDirectory) {
      return;
    }

    try {
      // pac modelbuilder reads org metadata — authenticate the extension's pac
      // profile first (previously this relied on whatever profile was active,
      // which failed on machines without one and could target the wrong org).
      const workspacePath = getWorkspacePath(context);
      if (workspacePath) {
        await ensurePacAuthForCurrentConnection(context, workspacePath);
      }
      await createSettingsTemplateFile(context, modelNamespace, serviceContextName, outputDirectory);
    } catch (error: any) {
      if (error?.stdout) {
        context.channel.appendLine(error.stdout);
      }
      if (error?.stderr) {
        context.channel.appendLine(error.stderr);
      }
      context.channel.appendLine(`Unable to create settings template file with pac: ${error?.error?.message || error?.message || "Unknown error"}`);
      vscode.window.showWarningMessage("Could not generate default template via pac. Continuing with built-in defaults.");
    }

    const generatedTemplate = await readModelBuilderSettingsFile(context);
    baseSettings = applyDefaults({
      ...generatedTemplate,
      namespace: modelNamespace,
      serviceContextName,
      outputDirectory,
      entityNamesFilter: [],
      messageNamesFilter: [],
    });

    context.projectSettings.pluginModelBuilder = baseSettings;
    try {
      await saveModelBuilderSettingsFile(baseSettings, context);
    } catch (error: any) {
      context.channel.appendLine(`Unable to save modelbuilder.json: ${JSON.stringify(error)}`);
      vscode.window.showErrorMessage("Could not save modelbuilder.json. Ensure there is not a folder named modelbuilder.json in the workspace root.");
      return;
    }
    await context.writeSettings();
    await updatePluginModelBuilderSettingsContext(context);
  }

  const configuredSettings = await configureEditableSettings(context, baseSettings);
  if (!configuredSettings) {
    return;
  }

  context.projectSettings.pluginModelBuilder = configuredSettings;
  try {
    await saveModelBuilderSettingsFile(configuredSettings, context);
  } catch (error: any) {
    context.channel.appendLine(`Unable to save modelbuilder.json: ${JSON.stringify(error)}`);
    vscode.window.showErrorMessage("Could not save modelbuilder.json. Ensure there is not a folder named modelbuilder.json in the workspace root.");
    return;
  }
  await context.writeSettings();
  await updatePluginModelBuilderSettingsContext(context);
  context.channel.appendLine("Plugin modelbuilder settings saved to modelbuilder.json.");
  vscode.window.showInformationMessage("Plugin modelbuilder settings saved.");
}

export async function editModelBuilderSetting(context: DataversePowerToolsContext, key: ModelBuilderSettingKey): Promise<boolean> {
  await loadPluginModelBuilderSettings(context);
  const existing = applyDefaults(context.projectSettings.pluginModelBuilder || {});
  const updated = await editSingleSetting(context, existing, key);
  if (!updated) {
    return false;
  }

  context.projectSettings.pluginModelBuilder = updated;
  await saveModelBuilderSettingsFile(updated, context);
  await context.writeSettings();
  await updatePluginModelBuilderSettingsContext(context);
  return true;
}

export async function generateEarlyBoundV3(context: DataversePowerToolsContext) {
  await loadPluginModelBuilderSettings(context);
  const settings = context.projectSettings.pluginModelBuilder;
  if (!vscode.workspace.workspaceFolders) {
    return;
  }

  if (!settings?.namespace || !settings.serviceContextName || !settings.outputDirectory) {
    const configureNow = await vscode.window.showWarningMessage("Plugin early bound settings are not configured. Configure now?", "Yes", "No");
    if (configureNow !== "Yes") {
      return;
    }
    await configureModelBuilderSettings(context);
  }

  const activeSettings = context.projectSettings.pluginModelBuilder;
  if (!activeSettings?.namespace || !activeSettings.serviceContextName || !activeSettings.outputDirectory) {
    return;
  }

  const workspacePath = activeComponentRoot(context)!;
  // Flags (and the semicolon-separated filter delimiter pac requires) live in the pure builder.
  const args = buildModelBuilderArgs(activeSettings);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating early bound classes with pac modelbuilder...",
    },
    async () => {
      try {
        // pac modelbuilder reads org metadata — authenticate the extension's
        // pac profile from the connection string first. Relying on the
        // machine's active profile broke on machines without one (and could
        // silently generate from the wrong org).
        if (!(await ensurePacAuthForCurrentConnection(context, workspacePath))) {
          return;
        }
        const { stdout, stderr } = await runPacWithAuthRetry(context, args, workspacePath);
        if (stdout) {
          context.channel.appendLine(stdout);
        }
        if (stderr) {
          context.channel.appendLine(stderr);
        }
        context.channel.appendLine("Plugin early bound generation complete.");
        vscode.window.showInformationMessage("Plugin early bound classes generated.");
      } catch (error: any) {
        if (error?.stdout) {
          context.channel.appendLine(error.stdout);
        }
        if (error?.stderr) {
          context.channel.appendLine(error.stderr);
        }
        context.channel.appendLine(`Error running pac modelbuilder: ${error?.error?.message || error?.message || "Unknown error"}`);
        context.channel.show();
        vscode.window.showErrorMessage("Error generating plugin early bound classes. See output for details.");
      }
    },
  );
}
