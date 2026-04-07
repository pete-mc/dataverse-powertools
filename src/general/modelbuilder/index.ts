import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../../context";
import { execFileAsync, resolvePacExecutable } from "./commandRunner";
import {
  applyDefaults,
  ensurePluginModelBuilderSettingsLoaded,
  getModelBuilderFilePath,
  getWorkspacePath,
  readModelBuilderSettingsFile,
  saveModelBuilderSettingsFile,
} from "./settingsFile";
import { configureEditableSettings, editSingleSetting, ModelBuilderSettingKey } from "./ui";

async function createSettingsTemplateFile(context: DataversePowerToolsContext, namespace: string, serviceContextName: string, outputDirectory: string): Promise<void> {
  const workspacePath = getWorkspacePath();
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

  const settingsFilePath = getModelBuilderFilePath();
  if (!settingsFilePath) {
    return;
  }

  const pacExecutable = await resolvePacExecutable();
  const args = ["modelbuilder", "build", "--namespace", namespace, "--serviceContextName", serviceContextName, "--outdirectory", outputDirectory, "--writesettingsTemplateFile"];

  const { stdout, stderr } = await execFileAsync(pacExecutable, args, workspacePath);
  if (stdout) {
    context.channel.appendLine(stdout);
  }
  if (stderr) {
    context.channel.appendLine(stderr);
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

    const generatedTemplate = await readModelBuilderSettingsFile();
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
      await saveModelBuilderSettingsFile(baseSettings);
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
    await saveModelBuilderSettingsFile(configuredSettings);
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
  await saveModelBuilderSettingsFile(updated);
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

  const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const pacExecutable = await resolvePacExecutable();
  const args = [
    "modelbuilder",
    "build",
    "--namespace",
    activeSettings.namespace,
    "--serviceContextName",
    activeSettings.serviceContextName,
    "--outdirectory",
    activeSettings.outputDirectory,
  ];

  if (activeSettings.entityNamesFilter && activeSettings.entityNamesFilter.length > 0) {
    args.push("--entityNamesFilter", activeSettings.entityNamesFilter.join(","));
  }

  if (activeSettings.entityTypesFolder) {
    args.push("--entityTypesFolder", activeSettings.entityTypesFolder);
  }

  if (activeSettings.messageNamesFilter && activeSettings.messageNamesFilter.length > 0) {
    args.push("--messageNamesFilter", activeSettings.messageNamesFilter.join(","));
  }

  if (activeSettings.messagesTypesFolder) {
    args.push("--messagesTypesFolder", activeSettings.messagesTypesFolder);
  }

  if (activeSettings.optionSetsTypesFolder) {
    args.push("--optionSetsTypesFolder", activeSettings.optionSetsTypesFolder);
  }

  if (activeSettings.emitEntityEtc) {
    args.push("--emitEntityETC");
  }

  if (activeSettings.emitFieldsClasses) {
    args.push("--emitFieldsClasses");
  }

  if (activeSettings.emitVirtualAttributes) {
    args.push("--emitVirtualAttributes");
  }

  if (activeSettings.generateGlobalOptionSets) {
    args.push("--generateGlobalOptionSets");
  }

  if (activeSettings.generateSdkMessages) {
    args.push("--generateSdkMessages");
  }

  if (activeSettings.logLevel) {
    args.push("--logLevel", activeSettings.logLevel);
  }

  if (activeSettings.suppressGeneratedCodeAttribute) {
    args.push("--suppressGeneratedCodeAttribute");
  }

  if (activeSettings.suppressINotifyPattern) {
    args.push("--suppressINotifyPattern");
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating early bound classes with pac modelbuilder...",
    },
    async () => {
      try {
        const { stdout, stderr } = await execFileAsync(pacExecutable, args, workspacePath);
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
