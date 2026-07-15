// Command: generate a typed front-end client from a `*.serverlogic.json` definition
// (#150 #4). Open the definition and run it — writes `<name>.client.ts` next to it,
// ready to import from a portal web file / PCF control for typed `shell.safeAjax`
// calls. Registered once, globally. Pure codegen lives in serverLogicClient.ts.

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { SERVER_LOGIC_FILE_SUFFIX, ServerLogicDefinition, generateServerLogicClient, serverLogicClientFileName, newServerLogicDefinition } from "./serverLogicClient";

export function registerServerLogicClient(context: DataversePowerToolsContext): void {
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.generateServerLogicClient", () => generateFromActive(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.newServerLogicDefinition", () => scaffold(context)));
}

async function scaffold(context: DataversePowerToolsContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("Open a folder first.");
    return;
  }
  const name = await vscode.window.showInputBox({
    prompt: "Server Logic name (the /_api/serverlogics/<name> resource).",
    validateInput: (v) => (/^[A-Za-z][A-Za-z0-9_]*$/.test(v.trim()) ? undefined : "Start with a letter; letters, digits and underscores only."),
  });
  if (!name) {
    return;
  }
  const filePath = path.join(folders[0].uri.fsPath, `${name.trim()}${SERVER_LOGIC_FILE_SUFFIX}`);
  if (fs.existsSync(filePath)) {
    vscode.window.showErrorMessage(`${path.basename(filePath)} already exists.`);
    return;
  }
  fs.writeFileSync(filePath, JSON.stringify(newServerLogicDefinition(name.trim()), null, 2) + "\n", "utf8");
  context.channel.appendLine(`Created Server Logic definition: ${filePath}`);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(filePath)));
}

async function generateFromActive(context: DataversePowerToolsContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document.fileName.toLowerCase().endsWith(SERVER_LOGIC_FILE_SUFFIX)) {
    vscode.window.showInformationMessage(`Open a ${SERVER_LOGIC_FILE_SUFFIX} definition, or run "New Server Logic definition" first.`);
    return;
  }

  let def: ServerLogicDefinition;
  try {
    def = JSON.parse(editor.document.getText()) as ServerLogicDefinition;
  } catch (error) {
    vscode.window.showErrorMessage(`${path.basename(editor.document.fileName)} is not valid JSON: ${(error as Error).message}`);
    return;
  }
  if (!def.name || !/^[A-Za-z][A-Za-z0-9_]*$/.test(def.name)) {
    vscode.window.showErrorMessage("The definition needs a valid 'name' (letter, then letters/digits/underscores).");
    return;
  }

  const outPath = path.join(path.dirname(editor.document.fileName), serverLogicClientFileName(def));
  fs.writeFileSync(outPath, generateServerLogicClient(def), "utf8");
  context.channel.appendLine(`Generated Server Logic client: ${outPath}`);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(outPath)));
  vscode.window.showInformationMessage(`Generated ${path.basename(outPath)} — copy it into your portal front-end / PCF project.`);
}
