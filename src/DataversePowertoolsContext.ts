import * as vscode from "vscode";
import * as cs from "./general/createConnectionString";
import path = require("path");
import fs = require("fs");

export default class DataversePowerToolsContext {
    vscode: vscode.ExtensionContext;
    channel: vscode.OutputChannel;
    projectSettings: ProjectSettings = {};
    connectionString: any;

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

    async readSettings() {
        if (vscode.workspace.workspaceFolders !== undefined) {
            const filePath = vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + this.settingsFilename;
            fs.readFile(filePath, "utf8", (err, data) => {
                if (err) {
                    this.channel.appendLine(`Error reading settings file: ${err}`);
                } else {
                    this.projectSettings = JSON.parse(data);
                    this.connectionString = this.projectSettings.connectionString;
                    vscode.window.showInformationMessage('Connected');
                }
            });
        }
    }

    async readConnectionString() {
        if (vscode.workspace.workspaceFolders !== undefined) {
            const connfile = await vscode.workspace.fs.readFile(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\connectionstring.txt"));
            const test2 = Buffer.from(connfile).toString("utf8");
            this.connectionString = Buffer.from(connfile).toString("utf8");
        }
    }

    async createSettings() {
        await cs.getSolutionName(this);
        await cs.createConnectionString(this);

        this.writeSettings();
    }
}

interface ProjectSettings {
    type?:  ProjectTypes;
    templateversion?: number;
    connectionString?: string;
    solutionName?: string;
}

export enum ProjectTypes {
    plugin,
    webresource, 
    pcfcontrol,
    solution,
}