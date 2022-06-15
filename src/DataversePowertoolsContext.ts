import * as vscode from "vscode";

export default class DataversePowertoolsContext {
    vscode: vscode.ExtensionContext;
    channel: vscode.OutputChannel;
    projectSettings: ProjectSettings = {};

    constructor(vscodeContext: vscode.ExtensionContext) {
        this.vscode = vscodeContext;
        this.channel = vscode.window.createOutputChannel("dataverse-powertools");
    }
}

interface ProjectSettings {
    type?: "plugin" | "webresource" | "pcfcontrol" | "solution";
    templateversion?: number;
    connectionString?: string;
}
