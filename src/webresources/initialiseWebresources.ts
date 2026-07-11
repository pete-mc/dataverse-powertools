import DataversePowerToolsContext, { PowertoolsTemplate } from "../context";
import { getTemplateFolderForType } from "../projectTypes/registry";
import * as vscode from "vscode";
import path = require("path");
import fs = require("fs");
import { addFormDecoration } from "./addFormDecoration";
import { buildWebresources } from "./buildWebresources";
import { createWebResourceClass, createWebResourceTest } from "./createWebresourceClass";
import { deployWebresources } from "./deployWebresources";
import { generateTypings } from "./generateTypings";
import { saveFormData } from "./saveFormData";
import { formIntersectSelector } from "./tableIntersects/tableIntersects";
import { upgradeFromSpkl } from "./upgradeFromSpkl";
import { debugWebResources, stopDebugWebResources } from "./debug/debugWebresources";
import { createWebresourceTestController } from "./webresourceTestController";
import { runTracked } from "../panel/operationTracker";
import { registerRegistrationsWatcher, scanFormRegistrations } from "../panel/registrationsScanner";

export function initialiseWebresources(context: DataversePowerToolsContext): void {
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPlugin", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isWebResource", true);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isSolution", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPortal", false);
  if (vscode.workspace.workspaceFolders) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    vscode.commands.executeCommand("setContext", "dataverse-powertools.hasSpkl", fs.existsSync(path.join(workspacePath, "spkl.json")));
  }
  if (context.projectSettings.type && context.projectSettings.templateversion && vscode.workspace.workspaceFolders) {
    if (vscode.workspace.workspaceFolders !== undefined && context.projectSettings.templateversion && vscode.workspace.workspaceFolders) {
      var fullFilePath = context.vscode.asAbsolutePath(path.join("templates", getTemplateFolderForType(context.projectSettings.type)!));
      var templates = JSON.parse(fs.readFileSync(path.join(fullFilePath, "template.json"), "utf8")) as Array<PowertoolsTemplate>;
      context.template = templates[0];
    }
  }
  formIntersectSelector(context);
  context.vscode.subscriptions.push(
    vscode.commands.registerCommand("dataverse-powertools.buildWebresources", () => runTracked(context, "Build", () => buildWebresources(context))),
  );
  context.vscode.subscriptions.push(
    vscode.commands.registerCommand("dataverse-powertools.deployWebresources", () => runTracked(context, "Deploy", () => deployWebresources(context))),
  );
  context.vscode.subscriptions.push(
    vscode.commands.registerCommand("dataverse-powertools.generateTypings", () => runTracked(context, "Generate typings", () => generateTypings(context))),
  );
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createWebResourceClass", () => createWebResourceClass(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.createWebResourceTest", () => createWebResourceTest(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.addFormDecoration", () => addFormDecoration(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.saveFormData", () => saveFormData(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.upgradeFromSpkl", () => upgradeFromSpkl(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.debugWebresources", () => debugWebResources(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.stopDebugWebresources", () => stopDebugWebResources()));
  // Ensure a running debug session (browser, webpack --watch, CDP) is torn down if the
  // extension deactivates or the workspace reloads.
  context.vscode.subscriptions.push({ dispose: () => void stopDebugWebResources() });
  // Surface the project's Jest tests in the native Test Explorer (#84).
  createWebresourceTestController(context);
  // The panel's registrations card tracks RegisterEvent decorations in source.
  registerRegistrationsWatcher(context);
  void scanFormRegistrations(context);
}
