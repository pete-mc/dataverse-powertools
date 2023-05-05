import * as vscode from 'vscode';
import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes } from "../context";
import path = require("path");
import fs = require("fs");

export async function generatePluginTemplate(context: DataversePowerToolsContext) {
  vscode.window.showInformationMessage("Generating");
  if (context.projectSettings.type && context.projectSettings.templateversion && vscode.workspace.workspaceFolders) {
    var fullFilePath = context.vscode.asAbsolutePath(path.join("templates", context.projectSettings.type));
    var templates = JSON.parse(fs.readFileSync(fullFilePath + "\\template.json", "utf8")) as Array<PowertoolsTemplate>;
    var templateToCopy = {} as PowertoolsTemplate;
    for (const t of templates) {
      if (t.version === context.projectSettings.templateversion) {
        templateToCopy = t;
        break;
      }
    }
    vscode.window.showInformationMessage("Generating template version: " + templateToCopy.version.toString());
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Generating early bound classes...",
    }, async () => {

      if (templateToCopy && templateToCopy.placeholders) {
        let placeholders = [] as TemplatePlaceholder[];
        for (const p of templateToCopy.placeholders) {
          placeholders.push({
            placeholder: p.placeholder, value: await vscode.window.showInputBox({
              prompt: p.displayName
            }) as string
          });
        }
        templateToCopy.files?.every(async (f) => {
          var data = fs.readFileSync(fullFilePath + "\\" + f.filename + f.extension + "\\" + context.projectSettings.templateversion + f.extension, "utf8");
          for (const p of placeholders) {
            data = data.replace(new RegExp(p.placeholder, "g"), p.value);
          }
          if (vscode.workspace.workspaceFolders) {
            const folderPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const destPath = f.path;
            destPath.unshift(folderPath);
            destPath.push(f.filename + f.extension);
            console.log(vscode.Uri.file(path.join(...destPath)), Buffer.from(data, "utf8"));
            await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(...destPath)), Buffer.from(data, "utf8"));
          }
        });
      }

    });
  }
}

interface TemplatePlaceholder {
  placeholder: string;
  value: string;
}