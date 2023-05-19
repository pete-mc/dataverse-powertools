import * as vscode from "vscode";
import DataversePowerToolsContext, { PowertoolsTemplate } from "../context";
import path = require("path");
import fs = require("fs");

export async function generateTemplates(context: DataversePowerToolsContext) {
  //inital system checks
  if (!context.projectSettings.type || !context.projectSettings.templateversion || !vscode.workspace.workspaceFolders) {
    vscode.window.showErrorMessage(!vscode.workspace.workspaceFolders ? "No folder open" : "No template type selected");
    return;
  }
  const folderPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  var templateFilePath = context.vscode.asAbsolutePath(path.join("templates", context.projectSettings.type));
  const templateToCopy = JSON.parse(fs.readFileSync(templateFilePath + "\\template.json", "utf8")).find((t: PowertoolsTemplate) => t.version === context.projectSettings.templateversion) as PowertoolsTemplate;
  if (!templateToCopy) {
    vscode.window.showErrorMessage("Could not find matching template");
    return;
  }
  vscode.window.showInformationMessage("Generating template version: " + templateToCopy.version.toString());
  let placeholders = [] as TemplatePlaceholder[];
  await templateToCopy.placeholders?.every(async (p) => {
    const placeholderValue = (await vscode.window.showInputBox({ prompt: p.displayName })) || p.placeholder;
    placeholders.push({ placeholder: p.placeholder, value: placeholderValue });
  });
  templateToCopy.files?.every(async (f) => {
    const extension = f.extension === ".tstemplate" ? ".ts" : f.extension; // This is done because the .ts files do not copy into the published extension thus we overwrite it when actually copying from extension into the code
    var data = fs.readFileSync(templateFilePath + "\\" + f.filename + f.extension + "\\" + f.version + f.extension, "utf8");
    data = data.replace(/\SOLUTIONPREFIX/g, context.projectSettings.prefix || "SOLUTIONPREFIX");
    data = data.replace(/\SOLUTIONPLACEHOLDER/g, context.projectSettings.solutionName || "SOLUTIONPLACEHOLDER");
    await templateToCopy.placeholders?.every((p) => {
      data = data.replace(new RegExp(p.placeholder, "g"), placeholders.find((x) => x.placeholder === p.placeholder)?.value || p.placeholder);
    });
    const destPath = f.path;
    destPath.unshift(folderPath);
    destPath.push(f.filename + extension);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(...destPath)), Buffer.from(data, "utf8"));
  });
}

export async function createTemplatedFile(context: DataversePowerToolsContext, sourceFilename: string, destinationFileName: string, replacements?: TemplatePlaceholder[]) {
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
    if (templateToCopy) {
      if (templateToCopy !== undefined && templateToCopy.files !== undefined) {
        const pluginTemplate = templateToCopy.files.find((x) => x.filename === sourceFilename);
        if (pluginTemplate !== undefined) {
          var data = fs.readFileSync(fullFilePath + "\\" + pluginTemplate.filename + pluginTemplate.extension + "\\" + context.projectSettings.templateversion + pluginTemplate.extension, "utf8");
          if (vscode.workspace.workspaceFolders) {
            const folderPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const destPath = pluginTemplate.path;
            destPath.unshift(folderPath);
            let fileExtension = pluginTemplate.extension;
            let fileName = pluginTemplate.filename;
            if (pluginTemplate.extension === ".tstemplate") {
              fileExtension = ".ts";
            }
            fileName = destinationFileName;
            if (replacements) {
              replacements.forEach((replacement) => {
                data = data.replace(new RegExp(replacement.placeholder, "g"), replacement.value);
              });
            }
            destPath.push(fileName + fileExtension);
            console.log(vscode.Uri.file(path.join(...destPath)), Buffer.from(data, "utf8"));
            await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(...destPath)), Buffer.from(data, "utf8"));
            vscode.workspace.openTextDocument(vscode.Uri.file(path.join(...destPath))).then((doc) => {
              vscode.window.showTextDocument(doc);
            });
          }
        }
      }
    }
  }
}

export interface TemplatePlaceholder {
  placeholder: string;
  value: string;
}
