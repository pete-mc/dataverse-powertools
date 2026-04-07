import * as vscode from "vscode";
import DataversePowerToolsContext, { PluginModelBuilderSettings } from "../context";
import { configureModelBuilderSettings, editModelBuilderSetting, loadPluginModelBuilderSettings } from "../general/modelbuilder";
import { applyDefaults } from "../general/modelbuilder/settingsFile";
import { ModelBuilderSettingKey } from "../general/modelbuilder/ui";

interface SettingTreeItem extends vscode.TreeItem {
  settingKey?: ModelBuilderSettingKey;
  children?: SettingTreeItem[];
}

export function pluginTableSelector(context: DataversePowerToolsContext) {
  new PluginModelBuilderTreeDataProvider(context);
}

class PluginModelBuilderTreeDataProvider implements vscode.TreeDataProvider<SettingTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<SettingTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private context: DataversePowerToolsContext;
  private data: SettingTreeItem[] = [];

  constructor(context: DataversePowerToolsContext) {
    this.context = context;

    vscode.window.registerTreeDataProvider("dataversePowerToolsTree", this);

    context.vscode.subscriptions.push(
      vscode.commands.registerCommand("dataverse-powertools.editModelBuilderSetting", async (item: SettingTreeItem) => {
        if (!item?.settingKey) {
          return;
        }

        const updated = await editModelBuilderSetting(this.context, item.settingKey);
        if (!updated) {
          return;
        }

        await this.reloadSettings();
      }),
    );

    void this.reloadSettings();
  }

  private async reloadSettings(): Promise<void> {
    await loadPluginModelBuilderSettings(this.context);
    this.buildTree();
    this.refresh();
  }

  private formatArrayValue(values: string[] | undefined): string {
    if (!values || values.length === 0) {
      return "(none)";
    }

    return values.join(", ");
  }

  private formatBoolValue(value: boolean | undefined): string {
    return value ? "Enabled" : "Disabled";
  }

  private createSettingRow(label: string, value: string, settingKey: ModelBuilderSettingKey): SettingTreeItem {
    return {
      label: `${label}: ${value}`,
      settingKey,
      contextValue: "ModelBuilderSetting",
      command: {
        command: "dataverse-powertools.editModelBuilderSetting",
        title: `Edit ${label}`,
        arguments: [{ settingKey }],
      },
      collapsibleState: vscode.TreeItemCollapsibleState.None,
    };
  }

  private createFilterItemRow(label: string, settingKey: ModelBuilderSettingKey): SettingTreeItem {
    return {
      label,
      settingKey,
      contextValue: "ModelBuilderFilterItem",
      command: {
        command: "dataverse-powertools.editModelBuilderSetting",
        title: `Edit ${settingKey}`,
        arguments: [{ settingKey }],
      },
      collapsibleState: vscode.TreeItemCollapsibleState.None,
    };
  }

  private buildTree(): void {
    const settings = applyDefaults(this.context.projectSettings.pluginModelBuilder || ({} as PluginModelBuilderSettings));

    const actionsRoot: SettingTreeItem = {
      label: "Actions",
      contextValue: "ModelBuilderActionsRoot",
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      children: [
        {
          label: "Configure All Settings",
          command: {
            command: "dataverse-powertools.configurePluginEarlyBound",
            title: "Configure All Settings",
          },
          contextValue: "ModelBuilderConfigureAction",
          collapsibleState: vscode.TreeItemCollapsibleState.None,
        },
        {
          label: "Generate Early Bound",
          command: {
            command: "dataverse-powertools.generateEarlyBound",
            title: "Generate Early Bound",
          },
          contextValue: "ModelBuilderGenerateAction",
          collapsibleState: vscode.TreeItemCollapsibleState.None,
        },
      ],
    };

    const selectedTables = settings.entityNamesFilter || [];
    const selectedTablesRoot: SettingTreeItem = {
      label: "Selected Tables",
      contextValue: "ModelBuilderSelectedTablesRoot",
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      children:
        selectedTables.length > 0 ? selectedTables.map((table) => this.createFilterItemRow(table, "entityNamesFilter")) : [this.createFilterItemRow("(none)", "entityNamesFilter")],
    };

    const selectedMessages = settings.messageNamesFilter || [];
    const selectedMessagesRoot: SettingTreeItem = {
      label: "Selected Messages",
      contextValue: "ModelBuilderSelectedMessagesRoot",
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      children:
        selectedMessages.length > 0
          ? selectedMessages.map((message) => this.createFilterItemRow(message, "messageNamesFilter"))
          : [this.createFilterItemRow("(none)", "messageNamesFilter")],
    };

    const settingsRoot: SettingTreeItem = {
      label: "Settings",
      contextValue: "ModelBuilderSettingsRoot",
      collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      children: [
        this.createSettingRow("Namespace", settings.namespace || "", "namespace"),
        this.createSettingRow("Service Context Name", settings.serviceContextName || "", "serviceContextName"),
        this.createSettingRow("Output Directory", settings.outputDirectory || "", "outputDirectory"),
        this.createSettingRow("Emit Entity Type Code", this.formatBoolValue(settings.emitEntityEtc), "emitEntityEtc"),
        this.createSettingRow("Emit Fields Classes", this.formatBoolValue(settings.emitFieldsClasses), "emitFieldsClasses"),
        this.createSettingRow("Emit Virtual Attributes", this.formatBoolValue(settings.emitVirtualAttributes), "emitVirtualAttributes"),
        this.createSettingRow("Entity Types Folder", settings.entityTypesFolder || "", "entityTypesFolder"),
        this.createSettingRow("Generate Global Option Sets", this.formatBoolValue(settings.generateGlobalOptionSets), "generateGlobalOptionSets"),
        this.createSettingRow("Generate SDK Messages", this.formatBoolValue(settings.generateSdkMessages), "generateSdkMessages"),
        this.createSettingRow("Log Level", settings.logLevel || "Off", "logLevel"),
        this.createSettingRow("Messages Types Folder", settings.messagesTypesFolder || "", "messagesTypesFolder"),
        this.createSettingRow("Option Sets Types Folder", settings.optionSetsTypesFolder || "", "optionSetsTypesFolder"),
        this.createSettingRow("Suppress Generated Code Attribute", this.formatBoolValue(settings.suppressGeneratedCodeAttribute), "suppressGeneratedCodeAttribute"),
        this.createSettingRow("Suppress INotify Pattern", this.formatBoolValue(settings.suppressINotifyPattern), "suppressINotifyPattern"),
      ],
    };

    this.data = [actionsRoot, selectedTablesRoot, selectedMessagesRoot, settingsRoot];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SettingTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SettingTreeItem): vscode.ProviderResult<SettingTreeItem[]> {
    if (!element) {
      return this.data;
    }

    return element.children as SettingTreeItem[] | undefined;
  }
}
