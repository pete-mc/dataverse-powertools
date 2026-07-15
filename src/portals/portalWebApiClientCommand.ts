// Commands: scaffold a `*.portalapi.json` definition and generate a typed portal
// Web API client from it (#150 #4). Mirrors the Server Logic client commands.
// Registered once, globally. Pure codegen in portalWebApiClient.ts.

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { PORTAL_API_FILE_SUFFIX, PortalWebApiDefinition, generatePortalWebApiClient, portalWebApiClientFileName, newPortalWebApiDefinition } from "./portalWebApiClient";

export function registerPortalWebApiClient(context: DataversePowerToolsContext): void {
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generatePortalWebApiClient", () => generateFromActive(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.newPortalWebApiDefinition", () => scaffold(context)));
}

async function scaffold(context: DataversePowerToolsContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("Open a folder first.");
    return;
  }
  const entitySet = await vscode.window.showInputBox({
    prompt: "Dataverse entity set name (the /_api/<entitySet> path, e.g. accounts).",
    validateInput: (v) => (/^[a-z][a-z0-9_]*$/.test(v.trim()) ? undefined : "Lower-case entity set name (e.g. accounts, contacts)."),
  });
  if (!entitySet) {
    return;
  }
  const filePath = path.join(folders[0].uri.fsPath, `${entitySet.trim()}${PORTAL_API_FILE_SUFFIX}`);
  if (fs.existsSync(filePath)) {
    vscode.window.showErrorMessage(`${path.basename(filePath)} already exists.`);
    return;
  }
  fs.writeFileSync(filePath, JSON.stringify(newPortalWebApiDefinition(entitySet.trim()), null, 2) + "\n", "utf8");
  context.channel.appendLine(`Created portal Web API definition: ${filePath}`);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(filePath)));
}

async function generateFromActive(context: DataversePowerToolsContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document.fileName.toLowerCase().endsWith(PORTAL_API_FILE_SUFFIX)) {
    vscode.window.showInformationMessage(`Open a ${PORTAL_API_FILE_SUFFIX} definition, or run "New Portal Web API definition" first.`);
    return;
  }

  let def: PortalWebApiDefinition;
  try {
    def = JSON.parse(editor.document.getText()) as PortalWebApiDefinition;
  } catch (error) {
    vscode.window.showErrorMessage(`${path.basename(editor.document.fileName)} is not valid JSON: ${(error as Error).message}`);
    return;
  }
  if (!def.entitySet || !/^[a-z][a-z0-9_]*$/.test(def.entitySet)) {
    vscode.window.showErrorMessage("The definition needs a valid lower-case 'entitySet' (e.g. accounts).");
    return;
  }

  const outPath = path.join(path.dirname(editor.document.fileName), portalWebApiClientFileName(def));
  fs.writeFileSync(outPath, generatePortalWebApiClient(def), "utf8");
  context.channel.appendLine(`Generated portal Web API client: ${outPath}`);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(outPath)));
  vscode.window.showInformationMessage(`Generated ${path.basename(outPath)} — copy it into your portal front-end / PCF project.`);
}
