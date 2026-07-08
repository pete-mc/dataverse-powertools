import * as vscode from "vscode";
import fs = require("fs");
import { createServicePrincipalString, getServicePrincipalString, getProjectType } from "./general/connectionStringManager";
import { DataverseContext } from "./general/dataverse/dataverseContext";
import { DataverseFormRecord } from "./general/dataverse/getDataverseForms";
import { workspaceFilePath } from "./general/paths";
import { parseConnectionString, buildConnectionString, getOrganizationUrl } from "./general/connectionString";
import { parseAuthType, DataverseAuthType } from "./general/dataverse/authTypes";

export default class DataversePowerToolsContext {
  public dataverse: DataverseContext;
  public vscode: vscode.ExtensionContext;
  public channel: vscode.OutputChannel;
  public projectSettings: ProjectSettings = {};
  public connectionString: string = "";
  public template?: PowertoolsTemplate;
  private settingsFilename: string = "dataverse-powertools.json";
  public statusBar: vscode.StatusBarItem;
  constructor(vscodeContext: vscode.ExtensionContext) {
    this.vscode = vscodeContext;
    this.channel = vscode.window.createOutputChannel("dataverse-powertools");
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBar.tooltip = "Dataverse PowerTools";
    this.statusBar.command = "dataverse-powertools.openSettings";
    this.dataverse = new DataverseContext(this);
  }

  async openSettings() {
    await vscode.commands.executeCommand("dataversePowerToolsMenu.focus");
  }

  /** Set the status bar text with the Dataverse PowerTools icon so it's identifiable. */
  setStatusBar(text: string): void {
    this.statusBar.text = `$(database) ${text}`;
    this.statusBar.show();
  }

  private settingsFilePath(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }
    return workspaceFilePath(folders[0].uri.fsPath, this.settingsFilename);
  }

  async writeSettings() {
    const filePath = this.settingsFilePath();
    if (filePath !== undefined) {
      let toWrite = JSON.parse(JSON.stringify(this.projectSettings));
      delete toWrite.pluginModelBuilder;
      if (typeof toWrite.connectionString === "string" && toWrite.connectionString.length > 0) {
        // Persist only the non-secret base; client id/secret live in secret storage.
        const parts = parseConnectionString(toWrite.connectionString);
        delete parts.clientId;
        delete parts.clientSecret;
        toWrite.connectionString = buildConnectionString(parts);
      }
      return new Promise<void>((resolve, reject) => {
        fs.writeFile(filePath, JSON.stringify(toWrite), (err) => {
          if (err) {
            this.channel.appendLine(`Error writing settings file: ${err}`);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
  }

  async readSettings() {
    const filePath = this.settingsFilePath();
    if (filePath !== undefined) {
      await this.readFileAsync(filePath)
        .then(async (data: any) => {
          this.projectSettings = JSON.parse(data);
          if (!this.projectSettings.webresourceSolutionName && this.projectSettings.solutionName) {
            this.projectSettings.webresourceSolutionName = this.projectSettings.solutionName;
          }
          this.connectionString = this.projectSettings.connectionString || "";
          // Interactive (OAuth) connections carry no client secret — the persisted
          // connection string is complete on its own, so don't look up a stored secret
          // or re-run the setup wizard (which asks for the auth type again).
          if (parseAuthType(parseConnectionString(this.connectionString).authType) !== DataverseAuthType.oauth) {
            const name = getOrganizationUrl(this.connectionString);
            const credentialString = await getServicePrincipalString(this, name);
            if (credentialString === "") {
              await createServicePrincipalString(this);
              this.connectionString = this.projectSettings.connectionString || "";
            } else {
              this.connectionString += credentialString;
            }
          }
        })
        .catch((err) => {
          if (err.code === "ENOENT") {
            this.channel.appendLine(`No project settings file found in the root of the workspace. Run the 'Dataverse PowerTools: Initialise Project' command to create one.`);
          } else {
            this.channel.appendLine(`Error reading settings file: ${err}`);
          }
        });
    }
  }

  async readFileAsync(filePath: string) {
    const data = await fs.promises.readFile(filePath);
    return data;
  }
}

interface ProjectSettings {
  placeholders?: TemplatePlaceholder[];
  type?: ProjectTypes;
  templateversion?: number;
  tenantId?: string;
  solutionName?: string;
  webresourceSolutionName?: string;
  connectionString?: string;
  prefix?: string;
  pluginProjectName?: string;
  pluginPackageName?: string;
  pluginPackageVersion?: string;
  pluginUnitTestingEnabled?: boolean;
  pluginUnitTestingFramework?: "mstest" | "xunit" | "nunit";
  pluginUnitTestingProject?: string;
  pluginModelBuilder?: PluginModelBuilderSettings;
  controlName?: string;
  formIntersect?: FormIntersect[];
}

export interface PluginModelBuilderSettings {
  namespace?: string;
  serviceContextName?: string;
  outputDirectory?: string;
  emitEntityEtc?: boolean;
  emitFieldsClasses?: boolean;
  emitVirtualAttributes?: boolean;
  entityNamesFilter?: string[];
  entityTypesFolder?: string;
  generateGlobalOptionSets?: boolean;
  generateSdkMessages?: boolean;
  logLevel?: string;
  messageNamesFilter?: string[];
  messagesTypesFolder?: string;
  optionSetsTypesFolder?: string;
  suppressGeneratedCodeAttribute?: boolean;
  suppressINotifyPattern?: boolean;
}

export interface FormIntersect {
  id: string;
  name: string;
  entity: string;
  forms: DataverseFormRecord[];
}

export interface TemplatePlaceholder {
  placeholder: string;
  value: string;
}

export enum ProjectTypes {
  plugin = "plugin",
  webresource = "webresources",
  solution = "solution",
  portal = "portal",
}
export interface PowertoolsTemplate {
  version: number;
  files?: File[];
  placeholders?: Placeholder[];
  initCommands?: RestoreCommand[];
  restoreCommands?: RestoreCommand[];
}
interface File {
  path: string[];
  filename: string;
  extension: string;
  version: number;
}

interface Placeholder {
  displayName: string;
  placeholder: string;
}

export interface RestoreCommand {
  command: string;
  params: string[];
}
