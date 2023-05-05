import * as vscode from 'vscode';
import DataversePowerToolsContext, { PowertoolsTemplate } from "../context";
import path = require("path");
import fs = require("fs");

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
      let placeholders = [] as TemplatePlaceholder[];
      templateToCopy.files?.every(async (f) => {
        var extension = '';

        // This is done because the .ts files do not copy into the published extension thus we overwrite it when actually copying from extension into the code
        if (f.extension === '.tstemplate') {
          extension = '.ts';
        } else {
          extension = f.extension;
        }
        var data = fs.readFileSync(fullFilePath + "\\" + f.filename + f.extension + "\\" + context.projectSettings.templateversion + f.extension, "utf8");
        if (f.filename === 'template' || f.filename === 'webpack.common')  {
          data = data.replace(/\SOLUTIONPREFIX/g, context.projectSettings.prefix || 'SOLUTIONPLACEHOLDER');
        }
        if (f.filename === 'spkl') {
          data = data.replace(/\SOLUTIONPLACEHOLDER/g, context.projectSettings.solutionName || 'SOLUTIONPLACEHOLDER');
        }
        if (Object.values(f.path).findIndex(x => x==='CONTROLNAME') !== -1) {
          f.path[Object.values(f.path).findIndex(x => x==='CONTROLNAME')] = context.projectSettings.controlName || '';
        }
        if (f.filename.includes('CONTROLNAME')) {
          const newName = f.filename.replace('CONTROLNAME', context.projectSettings.controlName || '');
          f.filename = newName;
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
  createClassFileWithName(context, 'Plugin');
}

export async function createWorkflowClass(context: DataversePowerToolsContext) {
  createClassFileWithName(context, 'Workflow');
}

export async function createWebResourceClass(context: DataversePowerToolsContext) {
  createClassFileWithName(context, 'account');
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
      if (templateToCopy !== undefined && templateToCopy.files !== undefined) {
        const pluginTemplate = templateToCopy.files.find(x => x.filename === type);
        if (pluginTemplate !== undefined) {
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

export async function createClassFileWithName(context: DataversePowerToolsContext, type: string) {
  const name = await vscode.window.showInputBox({prompt: "Enter in the name of the class file"});
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
        const pluginTemplate = templateToCopy.files.find(x => x.filename === type);
        if (pluginTemplate !== undefined) {
          var data = fs.readFileSync(fullFilePath + "\\" + pluginTemplate.filename + pluginTemplate.extension + "\\" + context.projectSettings.templateversion + pluginTemplate.extension, "utf8");
          if (vscode.workspace.workspaceFolders) {
            const folderPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const destPath = pluginTemplate.path;
            destPath.unshift(folderPath);
            let fileExtension = pluginTemplate.extension;
            let fileName = pluginTemplate.filename;
            if (pluginTemplate.extension === '.tstemplate') {
              fileExtension = '.ts';
            }

            if (name !== undefined && name !== '') {
              fileName = name;
              data = data.replace('Plugin :', name + ' :');
              data = data.replace('Workflow :', name + ' :');
            }
            destPath.push(fileName + fileExtension);
            console.log(vscode.Uri.file(path.join(...destPath)), Buffer.from(data, "utf8"));
            await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(...destPath)), Buffer.from(data, "utf8"));
          }
        }
      }
    }
  }
}

interface TemplatePlaceholder {
  placeholder: string;
  value: string;
}