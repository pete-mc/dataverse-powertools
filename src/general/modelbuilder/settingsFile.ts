import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import DataversePowerToolsContext, { PluginModelBuilderSettings } from "../../context";

export const MODEL_BUILDER_FILENAME = "modelbuilder.json";
export const LOG_LEVELS = ["Off", "Error", "Warning", "Information", "Verbose"];

export function getWorkspacePath(): string | undefined {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return undefined;
  }

  return vscode.workspace.workspaceFolders[0].uri.fsPath;
}

export function getModelBuilderFilePath(): string | undefined {
  const workspacePath = getWorkspacePath();
  if (!workspacePath) {
    return undefined;
  }

  return path.join(workspacePath, MODEL_BUILDER_FILENAME);
}

export function parseCsv(value?: string | string[] | null): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    const seenFromArray = new Set<string>();
    return value
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "")
      .filter((entry) => {
        const normalized = entry.toLowerCase();
        if (seenFromArray.has(normalized)) {
          return false;
        }
        seenFromArray.add(normalized);
        return true;
      });
  }

  const seen = new Set<string>();
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .filter((entry) => {
      const normalized = entry.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

export function toArray(values: string[]): string[] {
  return parseCsv(values);
}

export function applyDefaults(settings: Partial<PluginModelBuilderSettings>): PluginModelBuilderSettings {
  return {
    namespace: settings.namespace || "Dataverse.Plugins",
    serviceContextName: settings.serviceContextName || "XrmSvc",
    outputDirectory: settings.outputDirectory || "generated",
    emitEntityEtc: settings.emitEntityEtc ?? false,
    emitFieldsClasses: settings.emitFieldsClasses ?? false,
    emitVirtualAttributes: settings.emitVirtualAttributes ?? false,
    entityNamesFilter: parseCsv(settings.entityNamesFilter),
    entityTypesFolder: settings.entityTypesFolder || "Entities",
    generateGlobalOptionSets: settings.generateGlobalOptionSets ?? false,
    generateSdkMessages: settings.generateSdkMessages ?? false,
    logLevel: settings.logLevel && LOG_LEVELS.includes(settings.logLevel) ? settings.logLevel : "Information",
    messageNamesFilter: parseCsv(settings.messageNamesFilter),
    messagesTypesFolder: settings.messagesTypesFolder || "Messages",
    optionSetsTypesFolder: settings.optionSetsTypesFolder || "OptionSets",
    suppressGeneratedCodeAttribute: settings.suppressGeneratedCodeAttribute ?? false,
    suppressINotifyPattern: settings.suppressINotifyPattern ?? false,
  };
}

export async function readModelBuilderSettingsFile(): Promise<PluginModelBuilderSettings | undefined> {
  const filePath = getModelBuilderFilePath();
  if (!filePath) {
    return undefined;
  }

  try {
    const data = await fs.promises.readFile(filePath, "utf8");
    return applyDefaults(JSON.parse(data) as PluginModelBuilderSettings);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    if (error?.code === "EISDIR") {
      return undefined;
    }
    throw error;
  }
}

export async function saveModelBuilderSettingsFile(settings: PluginModelBuilderSettings): Promise<void> {
  const filePath = getModelBuilderFilePath();
  if (!filePath) {
    return;
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory: ${filePath}`);
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await fs.promises.writeFile(filePath, `${JSON.stringify(settings, undefined, 2)}\n`, "utf8");
}

export async function ensurePluginModelBuilderSettingsLoaded(context: DataversePowerToolsContext) {
  let loadedSettings = await readModelBuilderSettingsFile();
  let migratedLegacySettings = false;

  if (!loadedSettings && context.projectSettings.pluginModelBuilder) {
    loadedSettings = applyDefaults(context.projectSettings.pluginModelBuilder);
    await saveModelBuilderSettingsFile(loadedSettings);
    context.channel.appendLine("Migrated plugin modelbuilder settings to modelbuilder.json.");
    migratedLegacySettings = true;
  }

  context.projectSettings.pluginModelBuilder = loadedSettings;

  if (migratedLegacySettings) {
    await context.writeSettings();
  }
}
