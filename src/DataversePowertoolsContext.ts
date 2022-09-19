import * as vscode from "vscode";
import * as cp from "child_process";
import * as connectionStringManager from "./general/createConnectionString";
import path = require("path");
import fs = require("fs");
import { readProject, setUISettings } from "./general/initialiseProject";
import { generateTemplates } from "./general/generateTemplates";
import { restoreDependencies } from "./general/restoreDependencies";
import { createSNKKey, generateEarlyBound } from "./plugins/earlybound";
import { buildPlugin } from "./plugins/buildPlugin";

export default class DataversePowerToolsContext {
  vscode: vscode.ExtensionContext;
  channel: vscode.OutputChannel;
  projectSettings: ProjectSettings = {};
  connectionString: string = "";
  template?: PowertoolsTemplate;

  private settingsFilename: string = "dataverse-powertools.json";

  constructor(vscodeContext: vscode.ExtensionContext) {
    this.vscode = vscodeContext;
    this.channel = vscode.window.createOutputChannel("dataverse-powertools");
  }

  async writeSettings() {
    if (vscode.workspace.workspaceFolders !== undefined) {
      const filePath = vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + this.settingsFilename;
      let toWrite = JSON.parse(JSON.stringify(this.projectSettings));
      toWrite.connectionString = 
        toWrite.connectionString?.substring(0, toWrite.connectionString?.indexOf('ClientId'));
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
      await this.readFileAsync(filePath).then((data: any) => {
        this.projectSettings = JSON.parse(data);
        this.connectionString = this.projectSettings.connectionString || '';
        const name = context.connectionString.substring(context.connectionString.indexOf("Url=") + 4, context.connectionString.length - 1);
        context.connectionString += this.getCredentialsFromManager(this, name);
        context.projectSettings = this.projectSettings;
        vscode.window.showInformationMessage('Connected');
      }).catch((err) => {
        this.channel.appendLine(`Error reading settings file: ${err}`);
      })
      // await fs.readFile(filePath, "utf8", (err, data) => {
      //     if (err) {
      //         this.channel.appendLine(`Error reading settings file: ${err}`);
      //     } else {
      //         this.projectSettings = JSON.parse(data);
      //         this.connectionString = this.projectSettings.connectionString;
      //         vscode.window.showInformationMessage('Connected');
      //     }
      // });
    }
  }

  getCredentialsFromManager(context: DataversePowerToolsContext, name: string) {
    if (vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders) {
      const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      var fullFilePath = context.vscode.asAbsolutePath(path.join("templates"));
      const execSync = require("child_process").execSync;
      const generalCommand = "\"" + fullFilePath + "\\WindowsCredentialManager.exe\" Get-Credentials " + name;
      const userNameCommand = generalCommand + ' username';
      const passwordCommand = generalCommand + ' password';
      const resultUsername = execSync(userNameCommand);
      const resultPassword = execSync(passwordCommand);

      const username = resultUsername.toString("Utf-8");
      const password = resultPassword.toString("Utf-8");
      return "ClientId=" + username + ";" + "ClientSecret=" + password + ";"
      // context.connectionString += "ClientId=" + username + ";"
      // context.connectionString += "ClientSecret=" + password + ";"
    }
  }

  async readFileAsync(filePath: string) {
    const data = await fs.promises.readFile(filePath);
    return data;
  }

  async readConnectionString() {
    if (vscode.workspace.workspaceFolders !== undefined) {
      const connfile = await vscode.workspace.fs.readFile(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\connectionstring.txt"));
      const test2 = Buffer.from(connfile).toString("utf8");
      this.connectionString = Buffer.from(connfile).toString("utf8");
    }
  }

  async createSettings() {
    await connectionStringManager.getProjectType(this);
    // await connectionStringManager.getSolutionName(this);
    await connectionStringManager.createConnectionString(this);
    await generateTemplates(this);
    await this.writeSettings();
    await this.readSettings(this);
    await readProject(this);
    await setUISettings(this);
    await restoreDependencies(this);
    await createSNKKey(this);
    await generateEarlyBound(this);
    await buildPlugin(this);
  }
}

interface ProjectSettings {
  type?: ProjectTypes;
  templateversion?: number;
  solutionName?: string;
  connectionString?: string;
  prefix?: string;
}

export enum ProjectTypes {
  plugin = "plugin",
  webresource = "webresources",
  pcffield = "pcffield",
  pcfdataset = "pcfdataset",
  solution = "solution",

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