import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { TemplatePlaceholder, createTemplatedFile } from "../general/generateTemplates";
import path = require("path");

export async function createPluginClass(context: DataversePowerToolsContext) {
  if (!vscode.workspace.workspaceFolders) {
    return;
  }
  const name = await vscode.window.showInputBox({ prompt: "Enter in the name of the new class" });
  const placeholders = [{ placeholder: "ClassName", value: name ?? "" }] as TemplatePlaceholder[];
  await createTemplatedFile(context, "sampleClass", name ?? "BLANK", placeholders);
}

export async function createWorkflowClass(context: DataversePowerToolsContext) {
  if (!vscode.workspace.workspaceFolders) {
    return;
  }
  const name = await vscode.window.showInputBox({ prompt: "Enter in the name of the new class" });
  const placeholders = [{ placeholder: "ClassName", value: name ?? "" }] as TemplatePlaceholder[];
  await createTemplatedFile(context, "sampleWorkflow", name ?? "BLANK", placeholders);
}
