import * as vscode from "vscode";
import DataversePowerToolsContext, { PluginModelBuilderSettings } from "../../context";
import { getDataverseMessages } from "../dataverse/getDataverseMessages";
import { getDataverseTables } from "../dataverse/getDataverseTables";
import { applyDefaults, LOG_LEVELS, parseCsv, toArray } from "./settingsFile";

const MODEL_BUILDER_TITLE = "Plugin Model Builder Settings";

export type ModelBuilderSettingKey =
  | "namespace"
  | "serviceContextName"
  | "outputDirectory"
  | "emitEntityEtc"
  | "emitFieldsClasses"
  | "emitVirtualAttributes"
  | "entityNamesFilter"
  | "entityTypesFolder"
  | "generateGlobalOptionSets"
  | "generateSdkMessages"
  | "logLevel"
  | "messageNamesFilter"
  | "messagesTypesFolder"
  | "optionSetsTypesFolder"
  | "suppressGeneratedCodeAttribute"
  | "suppressINotifyPattern";

async function promptBoolean(title: string, prompt: string, currentValue: boolean): Promise<boolean | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: "Yes", value: true },
      { label: "No", value: false },
    ],
    {
      title,
      placeHolder: `${prompt} (current: ${currentValue ? "Yes" : "No"})`,
      ignoreFocusOut: true,
    },
  );

  return picked?.value;
}

async function promptLogLevel(currentValue: string): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(
    LOG_LEVELS.map((level) => ({
      label: level,
      description: level === currentValue ? "Current" : undefined,
      value: level,
    })),
    {
      title: MODEL_BUILDER_TITLE,
      placeHolder: "Log level",
      ignoreFocusOut: true,
    },
  );

  return picked?.value;
}

async function promptFilter(title: string, currentValue: string[], loadOptions: () => Promise<string[]>): Promise<string[] | undefined> {
  const currentCsv = currentValue.join(",");
  const mode = await vscode.window.showQuickPick(
    [
      { label: "Select from Dataverse", value: "dataverse" },
      { label: "Enter comma-separated values", value: "manual" },
      { label: "Clear", value: "clear" },
    ],
    {
      title: MODEL_BUILDER_TITLE,
      placeHolder: `${title} (current: ${currentCsv || "none"})`,
      ignoreFocusOut: true,
    },
  );

  if (!mode) {
    return undefined;
  }

  if (mode.value === "clear") {
    return [];
  }

  if (mode.value === "manual") {
    const manual = await vscode.window.showInputBox({
      title: MODEL_BUILDER_TITLE,
      prompt: `${title} (comma-separated)`,
      value: currentCsv,
      ignoreFocusOut: true,
    });

    return manual === undefined ? undefined : toArray(parseCsv(manual));
  }

  let options: string[] = [];
  try {
    options = await loadOptions();
  } catch {
    vscode.window.showWarningMessage(`Could not load ${title} from Dataverse. You can enter values manually.`);
    return currentValue;
  }

  if (options.length === 0) {
    vscode.window.showWarningMessage(`No Dataverse values found for ${title}.`);
    return currentValue;
  }

  const current = new Set(currentValue.map((value) => value.toLowerCase()));
  const selection = await vscode.window.showQuickPick(
    options.map((option) => ({
      label: option,
      picked: current.has(option.toLowerCase()),
    })),
    {
      title: MODEL_BUILDER_TITLE,
      placeHolder: `${title} (select one or more)`,
      canPickMany: true,
      ignoreFocusOut: true,
    },
  );

  if (!selection) {
    return undefined;
  }

  return toArray(selection.map((item) => item.label));
}

export async function configureEditableSettings(context: DataversePowerToolsContext, settings: PluginModelBuilderSettings): Promise<PluginModelBuilderSettings | undefined> {
  const emitEntityEtc = await promptBoolean(MODEL_BUILDER_TITLE, "Emit Entity Type Code", settings.emitEntityEtc ?? false);
  if (emitEntityEtc === undefined) {
    return undefined;
  }

  const emitFieldsClasses = await promptBoolean(MODEL_BUILDER_TITLE, "Emit Fields Classes", settings.emitFieldsClasses ?? false);
  if (emitFieldsClasses === undefined) {
    return undefined;
  }

  const emitVirtualAttributes = await promptBoolean(MODEL_BUILDER_TITLE, "Emit Virtual Attributes", settings.emitVirtualAttributes ?? false);
  if (emitVirtualAttributes === undefined) {
    return undefined;
  }

  const entityNamesFilter = await promptFilter("Entity Names Filter", settings.entityNamesFilter || [], () => getDataverseTables(context));
  if (entityNamesFilter === undefined) {
    return undefined;
  }

  const generateGlobalOptionSets = await promptBoolean(MODEL_BUILDER_TITLE, "Generate Global Option Sets", settings.generateGlobalOptionSets ?? false);
  if (generateGlobalOptionSets === undefined) {
    return undefined;
  }

  const generateSdkMessages = await promptBoolean(MODEL_BUILDER_TITLE, "Generate SDK Messages", settings.generateSdkMessages ?? false);
  if (generateSdkMessages === undefined) {
    return undefined;
  }

  const logLevel = await promptLogLevel(settings.logLevel || "Information");
  if (!logLevel) {
    return undefined;
  }

  const messageNamesFilter = await promptFilter("Message Names Filter", settings.messageNamesFilter || [], () => getDataverseMessages(context));
  if (messageNamesFilter === undefined) {
    return undefined;
  }

  const suppressGeneratedCodeAttribute = await promptBoolean(MODEL_BUILDER_TITLE, "Suppress Generated Code Attribute", settings.suppressGeneratedCodeAttribute ?? false);
  if (suppressGeneratedCodeAttribute === undefined) {
    return undefined;
  }

  const suppressINotifyPattern = await promptBoolean(MODEL_BUILDER_TITLE, "Suppress INotify Pattern", settings.suppressINotifyPattern ?? false);
  if (suppressINotifyPattern === undefined) {
    return undefined;
  }

  return applyDefaults({
    ...settings,
    emitEntityEtc,
    emitFieldsClasses,
    emitVirtualAttributes,
    entityNamesFilter,
    generateGlobalOptionSets,
    generateSdkMessages,
    logLevel,
    messageNamesFilter,
    suppressGeneratedCodeAttribute,
    suppressINotifyPattern,
  });
}

async function promptTextSetting(prompt: string, currentValue: string): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: MODEL_BUILDER_TITLE,
    prompt,
    value: currentValue,
    ignoreFocusOut: true,
  });

  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  return value.trim();
}

export async function editSingleSetting(
  context: DataversePowerToolsContext,
  settings: PluginModelBuilderSettings,
  key: ModelBuilderSettingKey,
): Promise<PluginModelBuilderSettings | undefined> {
  const current = applyDefaults(settings);

  switch (key) {
    case "namespace": {
      const value = await promptTextSetting("Class namespace for generated early-bound files", current.namespace || "Dataverse.Plugins");
      return value ? applyDefaults({ ...current, namespace: value }) : undefined;
    }
    case "serviceContextName": {
      const value = await promptTextSetting("Service context class name", current.serviceContextName || "XrmSvc");
      return value ? applyDefaults({ ...current, serviceContextName: value }) : undefined;
    }
    case "outputDirectory": {
      const value = await promptTextSetting("Output directory for generated files (relative to workspace)", current.outputDirectory || "generated");
      return value ? applyDefaults({ ...current, outputDirectory: value }) : undefined;
    }
    case "emitEntityEtc": {
      const value = await promptBoolean(MODEL_BUILDER_TITLE, "Emit Entity Type Code", current.emitEntityEtc ?? false);
      return value === undefined ? undefined : applyDefaults({ ...current, emitEntityEtc: value });
    }
    case "emitFieldsClasses": {
      const value = await promptBoolean(MODEL_BUILDER_TITLE, "Emit Fields Classes", current.emitFieldsClasses ?? false);
      return value === undefined ? undefined : applyDefaults({ ...current, emitFieldsClasses: value });
    }
    case "emitVirtualAttributes": {
      const value = await promptBoolean(MODEL_BUILDER_TITLE, "Emit Virtual Attributes", current.emitVirtualAttributes ?? false);
      return value === undefined ? undefined : applyDefaults({ ...current, emitVirtualAttributes: value });
    }
    case "entityNamesFilter": {
      const value = await promptFilter("Entity Names Filter", current.entityNamesFilter || [], () => getDataverseTables(context));
      return value === undefined ? undefined : applyDefaults({ ...current, entityNamesFilter: value });
    }
    case "entityTypesFolder": {
      const value = await promptTextSetting("Folder name for generated entities", current.entityTypesFolder || "Entities");
      return value ? applyDefaults({ ...current, entityTypesFolder: value }) : undefined;
    }
    case "generateGlobalOptionSets": {
      const value = await promptBoolean(MODEL_BUILDER_TITLE, "Generate Global Option Sets", current.generateGlobalOptionSets ?? false);
      return value === undefined ? undefined : applyDefaults({ ...current, generateGlobalOptionSets: value });
    }
    case "generateSdkMessages": {
      const value = await promptBoolean(MODEL_BUILDER_TITLE, "Generate SDK Messages", current.generateSdkMessages ?? false);
      return value === undefined ? undefined : applyDefaults({ ...current, generateSdkMessages: value });
    }
    case "logLevel": {
      const value = await promptLogLevel(current.logLevel || "Information");
      return value ? applyDefaults({ ...current, logLevel: value }) : undefined;
    }
    case "messageNamesFilter": {
      const value = await promptFilter("Message Names Filter", current.messageNamesFilter || [], () => getDataverseMessages(context));
      return value === undefined ? undefined : applyDefaults({ ...current, messageNamesFilter: value });
    }
    case "messagesTypesFolder": {
      const value = await promptTextSetting("Folder name for generated messages", current.messagesTypesFolder || "Messages");
      return value ? applyDefaults({ ...current, messagesTypesFolder: value }) : undefined;
    }
    case "optionSetsTypesFolder": {
      const value = await promptTextSetting("Folder name for generated option sets", current.optionSetsTypesFolder || "OptionSets");
      return value ? applyDefaults({ ...current, optionSetsTypesFolder: value }) : undefined;
    }
    case "suppressGeneratedCodeAttribute": {
      const value = await promptBoolean(MODEL_BUILDER_TITLE, "Suppress Generated Code Attribute", current.suppressGeneratedCodeAttribute ?? false);
      return value === undefined ? undefined : applyDefaults({ ...current, suppressGeneratedCodeAttribute: value });
    }
    case "suppressINotifyPattern": {
      const value = await promptBoolean(MODEL_BUILDER_TITLE, "Suppress INotify Pattern", current.suppressINotifyPattern ?? false);
      return value === undefined ? undefined : applyDefaults({ ...current, suppressINotifyPattern: value });
    }
  }
}
