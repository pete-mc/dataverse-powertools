import * as vscode from "vscode";
import * as cp from "child_process";
import path = require("path");
import fs = require("fs");
import DataversePowerToolsContext from "./DataversePowerToolsContext";
import { generateEarlyBound } from "./plugins/earlybound";
import { buildDeployPlugin } from "./plugins/buildDeployPlugin";
import { buildDeployWorkflow } from "./plugins/buildDeployWorkflow";
import { buildWebresources } from "./webresources/buildWebresources";
import { deployWebresources } from "./webresources/deployWebresources";
import { generateTypings } from "./webresources/generateTypings";
import { createConnectionString } from "./general/createConnectionString";
import { restoreDependencies } from './general/restoreDependencies';

export function activate(vscodeContext: vscode.ExtensionContext) {
    const context = new DataversePowerToolsContext(vscodeContext);
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.initialiseProject", () => generateEarlyBound(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createConnectionString", () => createConnectionString(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generateEarlyBound", () => generateEarlyBound(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildDeployPlugin", () => buildDeployPlugin(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildDeployWorkflow", () => buildDeployWorkflow(context)));

    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildWebresources", () => buildWebresources(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.deployWebresources", () => deployWebresources(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generateTypings", () => generateTypings(context)));
    // context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.restoreDependencies", () => restoreDependencies(context)));

    // Extension path example
    let fullFilePath = context.vscode.asAbsolutePath(path.join("templates", "test.txt"));
    let data = fs.readFileSync(fullFilePath, "utf8");
    context.channel.appendLine(data);
}

// this method is called when your extension is deactivated
export function deactivate() {}
