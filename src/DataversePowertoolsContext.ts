import * as vscode from "vscode";
import * as connectionStringManager from "./general/createConnectionString";
import path = require("path");
import fs = require("fs");
import { readProject, setUISettings } from "./general/initialiseProject";
import { generateTemplates } from "./general/generateTemplates";
import { restoreDependencies } from "./general/restoreDependencies";

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
            fs.writeFile(filePath, JSON.stringify(this.projectSettings), (err) => {
                if (err) {
                    this.channel.appendLine(`Error writing settings file: ${err}`);
                }
            });
        }
    }

    async readSettings(context: any) {
        if (vscode.workspace.workspaceFolders !== undefined) {
            const filePath = vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + this.settingsFilename;
            await this.readFileAsync(filePath).then((data: any) => {
                this.projectSettings = JSON.parse(data);
                this.connectionString = this.projectSettings.connectionString || '';
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
        await readProject(this);
        await setUISettings(this);
        await restoreDependencies(this);
    }
}

interface ProjectSettings {
    type?:  ProjectTypes;
    templateversion?: number;
    solutionName?: string;
    connectionString?: string;
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