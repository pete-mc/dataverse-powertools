import DataversePowerToolsContext, { PowertoolsTemplate } from "../context";
import { getTemplateFolderForType } from "../projectTypes/registry";
import { activeComponentRoot } from "../components/componentDiscovery";
import * as vscode from "vscode";
import path = require("path");
import fs = require("fs");
import { formIntersectSelector } from "./tableIntersects/tableIntersects";
import { stopDebugWebResources } from "./debug/debugWebresources";
import { createWebresourceTestController } from "./webresourceTestController";
import { registerRegistrationsWatcher, scanFormRegistrations } from "../panel/registrationsScanner";

// Per-type setup for web-resource components: context keys, template load,
// trees, test controller, watchers. Commands register once globally in
// projectTypes/activation.ts (#47) — never here.
export function initialiseWebresources(context: DataversePowerToolsContext): void {
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isWebResource", true);
  const componentRoot = activeComponentRoot(context);
  if (componentRoot) {
    vscode.commands.executeCommand("setContext", "dataverse-powertools.hasSpkl", fs.existsSync(path.join(componentRoot, "spkl.json")));
  }
  if (context.projectSettings.type && context.projectSettings.templateversion) {
    var fullFilePath = context.vscode.asAbsolutePath(path.join("templates", getTemplateFolderForType(context.projectSettings.type)!));
    var templates = JSON.parse(fs.readFileSync(path.join(fullFilePath, "template.json"), "utf8")) as Array<PowertoolsTemplate>;
    context.template = templates[0];
  }
  formIntersectSelector(context);
  // Ensure a running debug session (browser, webpack --watch, CDP) is torn down if the
  // extension deactivates or the workspace reloads.
  context.vscode.subscriptions.push({ dispose: () => void stopDebugWebResources() });
  // Surface the project's Jest tests in the native Test Explorer (#84).
  createWebresourceTestController(context);
  // The panel's registrations card tracks RegisterEvent decorations in source.
  registerRegistrationsWatcher(context);
  void scanFormRegistrations(context);
}
