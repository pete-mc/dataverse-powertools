import * as vscode from "vscode";
import fs = require("fs");
import { setUISettings } from "./general/initialiseExtension";
import { generateTemplates } from "./general/generateTemplates";
import { restoreDependencies } from "./general/restoreDependencies";
import { createSNKKey, generateEarlyBound } from "./plugins/earlybound";
import { buildProject } from "./plugins/buildPlugin";
import { createServicePrincipalString, getServicePrincipalString, getProjectType } from "./general/connectionManager";

export default class DataversePowerToolsContext {
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
  }

  async openSettings() {
    await vscode.commands.executeCommand("dataversePowerToolsMenu.focus");
  }

  async writeSettings() {
    if (vscode.workspace.workspaceFolders !== undefined) {
      const filePath = vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + this.settingsFilename;
      let toWrite = JSON.parse(JSON.stringify(this.projectSettings));
      toWrite.connectionString = toWrite.connectionString?.substring(0, toWrite.connectionString?.indexOf("ClientId"));
      fs.writeFile(filePath, JSON.stringify(toWrite), (err) => {
        if (err) {
          this.channel.appendLine(`Error writing settings file: ${err}`);
        }
      });
    }
  }

  async readSettings(context: DataversePowerToolsContext) {
    if (vscode.workspace.workspaceFolders !== undefined) {
      const filePath = vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + this.settingsFilename;
      await this.readFileAsync(filePath)
        .then(async (data: any) => {
          this.projectSettings = JSON.parse(data);
          this.connectionString = this.projectSettings.connectionString || "";
          let name = context.connectionString.substring(context.connectionString.indexOf("Url=") + 4, context.connectionString.length - 1);
          name = name.replace(/\/+$/, "");
          const credentialString = await getServicePrincipalString(this, name);
          if (credentialString === "") {
            await createServicePrincipalString(this);
            context.connectionString = this.projectSettings.connectionString || "";
          } else {
            context.connectionString += credentialString;
          }
          context.projectSettings = this.projectSettings;
        })
        .catch((err) => {
          this.channel.appendLine(`Error reading settings file: ${err}`);
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
  connectionString?: string;
  prefix?: string;
  controlName?: string;
}

export interface TemplatePlaceholder {
  placeholder: string;
  value: string;
}

export enum ProjectTypes {
  plugin = "plugin",
  webresource = "webresources",
  pcffield = "pcffield",
  pcfdataset = "pcfdataset",
  solution = "solution",
  portal = "portal",
}
export interface PowertoolsTemplate {
  version: number;
  files?: File[];
  placeholders?: Placeholder[];

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

interface RestoreCommand {
  command: string;
  params: string[];
}
