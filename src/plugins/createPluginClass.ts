import * as vscode from "vscode";
import DataversePowerToolsContext, { TemplatePlaceholder } from "../context";
import { createTemplatedFile } from "../general/generateTemplates";
import path = require("path");

export async function createPluginClass(context: DataversePowerToolsContext) {
  if (!vscode.workspace.workspaceFolders) {
    return;
  }
  const name = await vscode.window.showInputBox({ prompt: "Enter in the name of the new class" });
  const placeholders = [{ placeholder: "ClassName", value: name ?? "" }] as TemplatePlaceholder[];
  await createTemplatedFile(context, "sampleClass", name ?? "BLANK", placeholders, true);
  await createTemplatedFile(context, "sampleTest", name ?? "BLANK", placeholders, false);
}

export async function createWorkflowClass(context: DataversePowerToolsContext) {
  if (!vscode.workspace.workspaceFolders) {
    return;
  }
  const name = await vscode.window.showInputBox({ prompt: "Enter in the name of the new class" });
  const placeholders = [{ placeholder: "ClassName", value: name ?? "" }] as TemplatePlaceholder[];
  await createTemplatedFile(context, "sampleWorkflow", name ?? "BLANK", placeholders, true);
}
