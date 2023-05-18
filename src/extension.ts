import * as vscode from "vscode";
import * as cs from "./general/initialiseProject";
import path = require("path");
import fs = require("fs");
import DataversePowerToolsContext from "./context";
import { createSNKKey, generateEarlyBound } from "./plugins/earlybound";
import { buildDeployPlugin } from "./plugins/buildDeployPlugin";
import { buildDeployWorkflow } from "./plugins/buildDeployWorkflow";
import { buildWebresources } from "./webresources/buildWebresources";
import { deployWebresources } from "./webresources/deployWebresources";
import { generateTypings } from "./webresources/generateTypings";
import { createServicePrincipalString, updateConnectionString } from "./general/connectionManager";
import { restoreDependencies } from './general/restoreDependencies';
import { buildPlugin } from "./plugins/buildPlugin";
import { createPluginClass, createWorkflowClass } from "./general/generateTemplates";
import { extractSolution } from "./solution/extractSolution";
import { packSolution } from "./solution/packSolution";
import { deploySolution } from "./solution/deploySolution";
import { connectPortal } from "./portals/connectPortal";
import { createWebResourceClass, createWebResourceTest } from "./webresources/createWebresourceClass";

export async function activate(vscodeContext: vscode.ExtensionContext) {
    const context = new DataversePowerToolsContext(vscodeContext);
    context.channel.appendLine(fs.readFileSync(context.vscode.asAbsolutePath(path.join("templates", "logo.txt")), "utf8"));
    context.channel.appendLine(`version: ${vscodeContext.extension.packageJSON.version}`);

    await context.readSettings(context);
    await cs.setUISettings(context);
//#region General
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.initialiseProject", () => context.initialiseProject()));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createConnectionString", () => createServicePrincipalString(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.restoreDependencies", () => restoreDependencies(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.updateConnectionString", () => updateConnectionString(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.openSettings", () => context.openSettings()));
//#endregion
//#region Plugins
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generateEarlyBound", () => generateEarlyBound(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildDeployPlugin", () => buildDeployPlugin(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildPlugin", () => buildPlugin(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildDeployWorkflow", () => buildDeployWorkflow(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createPluginClass", () => createPluginClass(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createWorkflowClass", () => createWorkflowClass(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createSNKKey", () => createSNKKey(context)));
//#endregion
//#region webresources
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildWebresources", () => buildWebresources(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.deployWebresources", () => deployWebresources(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generateTypings", () => generateTypings(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createWebResourceClass", () => createWebResourceClass(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createWebResourceTest", () => createWebResourceTest(context)));
//#endregion
//#region Solution
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.extractSolution", () => extractSolution(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.packSolution", () => packSolution(context)));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.deploySolution", () => deploySolution(context)));
//#endregion
//#region Portals
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.connectPortal", () => connectPortal(context, 'connect')));
    context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.downloadPortal", () => connectPortal(context, 'download')));
//#endregion

}

