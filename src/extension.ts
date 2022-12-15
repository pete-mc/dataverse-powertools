import * as vscode from "vscode";
import * as cp from "child_process";
import * as cs from "./general/initialiseProject";
import path = require("path");
import fs = require("fs");
import DataversePowerToolsContext from "./DataversePowerToolsContext";
import { createSNKKey, generateEarlyBound } from "./plugins/earlybound";
import { buildDeployPlugin } from "./plugins/buildDeployPlugin";
import { buildDeployWorkflow } from "./plugins/buildDeployWorkflow";
import { buildWebresources } from "./webresources/buildWebresources";
import { deployWebresources } from "./webresources/deployWebresources";
import { generateTypings } from "./webresources/generateTypings";
import { createConnectionString } from "./general/createConnectionString";
import { restoreDependencies } from './general/restoreDependencies';
//import { initialiseWebresources } from "./webresources/initialiseWebresources";
import { initialiseProject } from "./general/initialiseProject";
import { buildPlugin } from "./plugins/buildPlugin";
import { createPluginClass, createWebResourceClass, createWorkflowClass } from "./general/generateTemplates";
import { extractSolution } from "./solution/extractSolution";
import { packSolution } from "./solution/packSolution";
import { deploySolution } from "./solution/deploySolution";
import { connectPortal, downloadPortal } from "./portals/connectPortal";

export async function activate(vscodeContext: vscode.ExtensionContext) {
    const context = new DataversePowerToolsContext(vscodeContext);
    await cs.readProject(context);
    await cs.setUISettings(context);
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.initialiseProject", () => initialiseProject(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createConnectionString", () => createConnectionString(context)));
    //context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.initialiseWebresources", () => initialiseWebresources(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generateEarlyBound", () => generateEarlyBound(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildDeployPlugin", () => buildDeployPlugin(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildPlugin", () => buildPlugin(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildDeployWorkflow", () => buildDeployWorkflow(context)));

    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildWebresources", () => buildWebresources(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.deployWebresources", () => deployWebresources(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generateTypings", () => generateTypings(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generateTemplate", () => generateTemplates(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createPluginClass", () => createPluginClass(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createWorkflowClass", () => createWorkflowClass(context)));

    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.restoreDependencies", () => restoreDependencies(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createSNKKey", () => createSNKKey(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.extractSolution", () => extractSolution(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.packSolution", () => packSolution(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.deploySolution", () => deploySolution(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createWebResourceClass", () => createWebResourceClass(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.connectPortal", () => connectPortal(context, 'connect')));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.downloadPortal", () => connectPortal(context, 'download')));

    // Extension path example
    let fullFilePath = context.vscode.asAbsolutePath(path.join("templates", "test.txt"));
    let data = fs.readFileSync(fullFilePath, "utf8");
    context.channel.appendLine(data);
}

// this method is called when your extension is deactivated
export function deactivate() {}
function generateTemplates(context: DataversePowerToolsContext): any {
    throw new Error("Function not implemented.");
}

