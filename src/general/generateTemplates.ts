import * as vscode from 'vscode';
import DataversePowerToolsContext, { PowertoolsTemplate } from "../DataversePowerToolsContext";
import path = require("path");
import fs = require("fs");
import { create } from 'domain';

export async function generateTemplates(context: DataversePowerToolsContext) {
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
    if (templateToCopy) {
      let placeholders = [] as templatePlaceholder[];
      // for (const p of templateToCopy.placeholders) {
      //   placeholders.push({
      //     placeholder: p.placeholder, value: await vscode.window.showInputBox({
      //       prompt: p.displayName
      //     }) as string
      //   });
      // }
      templateToCopy.files?.every(async (f) => {
        var extension = '';
        if (f.extension == '.tstemplate') {
          extension = '.ts';
        } else {
          extension = f.extension;
        }
        var data = fs.readFileSync(fullFilePath + "\\" + f.filename + f.extension + "\\" + context.projectSettings.templateversion + f.extension, "utf8");

        if (f.filename === 'template' || f.filename === 'webpack.common')  {
          data = data.replace(/\SOLUTIONPREFIX/g, context.projectSettings.prefix || 'SOLUTIONPLACEHOLDER')
        }

        if (f.filename == 'spkl') {
          data = data.replace(/\SOLUTIONPLACEHOLDER/g, context.projectSettings.solutionName || 'SOLUTIONPLACEHOLDER')
        }
        for (const p of placeholders) {
          //data = data.replace(new RegExp(p.placeholder, "g"), p.value);
        }
        if (vscode.workspace.workspaceFolders) {
          const folderPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
          const destPath = f.path;
          destPath.unshift(folderPath);
          destPath.push(f.filename + extension);
          console.log(vscode.Uri.file(path.join(...destPath)), Buffer.from(data, "utf8"));
          await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(...destPath)), Buffer.from(data, "utf8"));
        }
      });
    }
  }
}

export async function createPluginClass(context: DataversePowerToolsContext) {
  createClassFile(context, 'Plugin');
}

export async function createWorkflowClass(context: DataversePowerToolsContext) {
  createClassFile(context, 'Workflow');
}

export async function createClassFile(context: DataversePowerToolsContext, type: string) {
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
    if (templateToCopy && templateToCopy.placeholders) {
      if (templateToCopy != null && templateToCopy.files != null) {
        const pluginTemplate = templateToCopy.files.find(x => x.filename == type);
        if (pluginTemplate != null) {
          var data = fs.readFileSync(fullFilePath + "\\" + pluginTemplate.filename + pluginTemplate.extension + "\\" + context.projectSettings.templateversion + pluginTemplate.extension, "utf8");
          if (vscode.workspace.workspaceFolders) {
            const folderPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const destPath = pluginTemplate.path;
            destPath.unshift(folderPath);
            destPath.push(pluginTemplate.filename + pluginTemplate.extension);
            console.log(vscode.Uri.file(path.join(...destPath)), Buffer.from(data, "utf8"));
            await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(...destPath)), Buffer.from(data, "utf8"));
          }
        }
      }
    }
  }
}

interface templatePlaceholder {
  placeholder: string;
  value: string;
}