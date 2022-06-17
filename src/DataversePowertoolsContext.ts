import * as vscode from "vscode";
import path = require("path");
import fs = require("fs");

export default class DataversePowerToolsContext {
    vscode: vscode.ExtensionContext;
    channel: vscode.OutputChannel;
    projectSettings: ProjectSettings = {};
    private settingsFilename: string = "dataverse-powertools.json";

    constructor(vscodeContext: vscode.ExtensionContext) {
        this.vscode = vscodeContext;
        this.channel = vscode.window.createOutputChannel("dataverse-powertools");
    }

    async writeSettings() {
        // ! need to replace this with workspace folder path not extension path
        const filePath = this.vscode.asAbsolutePath(path.join(this.settingsFilename));
        fs.writeFile(filePath, JSON.stringify(this.projectSettings), (err) => {
            if (err) {
                this.channel.appendLine(`Error writing settings file: ${err}`);
            }
        });
    }

    async readSettings() {
        // ! need to replace this with workspace folder path not extension path
        const filePath = this.vscode.asAbsolutePath(path.join(this.settingsFilename));
        fs.readFile(filePath, "utf8", (err, data) => {
            if (err) {
                this.channel.appendLine(`Error reading settings file: ${err}`);
            } else {
                this.projectSettings = JSON.parse(data);
            }
        });
    }
}

interface ProjectSettings {
    type?: "plugin" | "webresource" | "pcfcontrol" | "solution";
    templateversion?: number;
    connectionString?: string;
}
