import DataversePowerToolsContext, { PowertoolsTemplate } from "../context";
import * as vscode from "vscode";
import path = require("path");
import fs = require("fs");
import { addFormDecoration } from "./addFormDecoration";
import { buildWebresources } from "./buildWebresources";
import { createWebResourceClass, createWebResourceTest } from "./createWebresourceClass";
import { deployWebresources } from "./deployWebresources";
import { generateTypings } from "./generateTypings";
import { saveFormData } from "./saveFormData";

export function initialiseWebresources(context: DataversePowerToolsContext): void {
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPlugin", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isWebResource", true);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isSolution", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPortal", false);
  if (context.projectSettings.type && context.projectSettings.templateversion && vscode.workspace.workspaceFolders) {
    if (vscode.workspace.workspaceFolders !== undefined && context.projectSettings.templateversion && vscode.workspace.workspaceFolders) {
      var fullFilePath = context.vscode.asAbsolutePath(path.join("templates", context.projectSettings.type));
      var templates = JSON.parse(fs.readFileSync(fullFilePath + "\\template.json", "utf8")) as Array<PowertoolsTemplate>;
      context.template = templates[0];
    }
  }
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildWebresources", () => buildWebresources(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.deployWebresources", () => deployWebresources(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generateTypings", () => generateTypings(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createWebResourceClass", () => createWebResourceClass(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createWebResourceTest", () => createWebResourceTest(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.addFormDecoration", () => addFormDecoration(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.saveFormData", () => saveFormData(context)));
}
