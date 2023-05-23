import * as vscode from "vscode";
import DataversePowerToolsContext, { TemplatePlaceholder } from "../context";
import { createTemplatedFile } from "../general/generateTemplates";
import path = require("path");

export async function createWebResourceClass(context: DataversePowerToolsContext) {
  if (!vscode.workspace.workspaceFolders) {
    return;
  }
  const name = await vscode.window.showInputBox({ prompt: "Enter in the name of the new class" });
  const placeholders = [
    { placeholder: "TableName", value: (await vscode.window.showInputBox({ prompt: "Enter in the name of the Dataverse Table" })) ?? "" },
    { placeholder: "FormName", value: (await vscode.window.showInputBox({ prompt: "Enter in the name of the Dataverse Form" })) ?? "" },
    { placeholder: "ClassName", value: name ?? "" },
  ] as TemplatePlaceholder[];
  await createTemplatedFile(context, "class", name ?? "", placeholders);
  var library = (await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, "webresources_src", "library.ts")))).toString();
  library = library.trim() + ('\nexport * from "./' + name + '";\n');
  await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, "webresources_src", "library.ts")), Buffer.from(library, "utf8"));
}

export async function createWebResourceTest(context: DataversePowerToolsContext) {
  if (!vscode.workspace.workspaceFolders) {
    return;
  }
  const name = await vscode.window.showInputBox({ prompt: "Enter in the name of the class to test" });
  const placeholders = [
    { placeholder: "TableName", value: (await vscode.window.showInputBox({ prompt: "Enter in the name of the Dataverse Table" })) ?? "" },
    { placeholder: "FormName", value: (await vscode.window.showInputBox({ prompt: "Enter in the name of the Dataverse Form" })) ?? "" },
    { placeholder: "ClassName", value: name ?? "" },
  ] as TemplatePlaceholder[];
  await createTemplatedFile(context, "sample.test", (name ?? "") + ".test", placeholders);
}
