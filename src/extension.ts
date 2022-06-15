import * as vscode from "vscode";
import * as cp from "child_process";
import { generateEarlyBound } from "./plugins/earlybound";
import { buildDeployPlugin } from "./plugins/buildDeployPlugin";
import { buildDeployWorkflow } from "./plugins/buildDeployWorkflow";
import path = require("path");
import fs = require("fs");
import DataversePowertoolsContext from "./DataversePowertoolsContext";

export function activate(vscodeContext: vscode.ExtensionContext) {
    const context = new DataversePowertoolsContext(vscodeContext);

    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generateEarlyBound", () => generateEarlyBound(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildDeployPlugin", () => buildDeployPlugin(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildDeployWorkflow", () => buildDeployWorkflow(context)));

    // Extension path example
    let fullFilePath = context.vscode.asAbsolutePath(path.join("templates", "test.txt"));
    let data = fs.readFileSync(fullFilePath, "utf8");
    context.channel.appendLine(data);
}

// this method is called when your extension is deactivated
export function deactivate() {}
