import * as vscode from "vscode";
import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes, TemplatePlaceholder } from "../context";
import path = require("path");
import fs = require("fs");
import { createServicePrincipalString, getProjectType } from "./connectionStringManager";
import { generalInitialise } from "./initialiseExtension";
import { restoreDependencies } from "./restoreDependencies";
import { createSNKKey, generateEarlyBound } from "../plugins/earlybound";
import { buildProject } from "../plugins/buildPlugin";
import { generateTypings } from "../webresources/generateTypings";
import { initialisePlugins } from "../plugins/initialisePlugins";

export async function createNewProject(context: DataversePowerToolsContext) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Creating new project...",
    },
    async () => {
      await getProjectType(context);
      await createServicePrincipalString(context);
      await generateTemplates(context);
      await context.writeSettings();
      await context.readSettings();
      await restoreDependencies(context);
      await generalInitialise(context);
      switch (context.projectSettings.type) {
        case ProjectTypes.plugin:
          await createSNKKey(context);
          await generateEarlyBound(context);
          await buildProject(context);
          initialisePlugins(context);
          break;
        case ProjectTypes.webresource:
          await generateTypings(context);
          break;
      }
  });
  vscode.window.showInformationMessage("Project created");
}

export async function generateTemplates(context: DataversePowerToolsContext) {
  //inital system checks
  if (!context.projectSettings.type || !context.projectSettings.templateversion || !vscode.workspace.workspaceFolders) {
    vscode.window.showErrorMessage(!vscode.workspace.workspaceFolders ? "No folder open" : "No template type selected");
    return;
  }
  const folderPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  var templateFilePath = context.vscode.asAbsolutePath(path.join("templates", context.projectSettings.type));
  const templateToCopy = JSON.parse(fs.readFileSync(templateFilePath + "\\template.json", "utf8")).find(
    (t: PowertoolsTemplate) => t.version === context.projectSettings.templateversion,
  ) as PowertoolsTemplate;
  if (!templateToCopy) {
    vscode.window.showErrorMessage("Could not find matching template");
    return;
  }
  context.channel.appendLine("Generating template version: " + templateToCopy.version.toString());
  let placeholders = [] as TemplatePlaceholder[];
  if (templateToCopy.placeholders) {
    for (let i = 0; i < templateToCopy.placeholders.length; i++) {
      const p = templateToCopy.placeholders[i];
      if (p.placeholder === "SOLUTIONPREFIX" || p.placeholder === "SOLUTIONPLACEHOLDER") {
        continue;
      }
      const placeholderValue = (await vscode.window.showInputBox({ prompt: p.displayName })) || p.placeholder;
      placeholders.push({ placeholder: p.placeholder, value: placeholderValue });
    }
  }
  context.projectSettings.placeholders = placeholders;
  templateToCopy.files?.every(async (f) => {
    const extension = f.extension === ".tstemplate" ? ".ts" : f.extension; // This is done because the .ts files do not copy into the published extension thus we overwrite it when actually copying from extension into the code
    var data = fs.readFileSync(templateFilePath + "\\" + f.filename + f.extension + "\\" + f.version + f.extension, "utf8");
    data = data.replace(/\SOLUTIONPREFIX/g, context.projectSettings.prefix || "SOLUTIONPREFIX");
    data = data.replace(/\SOLUTIONPLACEHOLDER/g, context.projectSettings.solutionName || "SOLUTIONPLACEHOLDER");
    const destPath = f.path;
    destPath.unshift(folderPath);
    destPath.push(f.filename + extension);
    var destPathString = path.join(...destPath);
    for (let i = 0; i < placeholders.length; i++) {
      const p = placeholders[i];
      data = data.replace(new RegExp(p.placeholder, "g"), p.value || p.placeholder);
      destPathString = destPathString.replace(new RegExp(p.placeholder, "g"), p.value || p.placeholder);
    }
    await vscode.workspace.fs.writeFile(vscode.Uri.file(destPathString), Buffer.from(data, "utf8"));
  });
  context.channel.appendLine("Template generation complete");
}

export async function createTemplatedFile(
  context: DataversePowerToolsContext,
  sourceFilename: string,
  destinationFileName: string,
  replacements?: TemplatePlaceholder[],
  openFile?: boolean,
) {
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
          var data = fs.readFileSync(
            fullFilePath + "\\" + pluginTemplate.filename + pluginTemplate.extension + "\\" + context.projectSettings.templateversion + pluginTemplate.extension,
            "utf8",
          );
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
              for (let i = 0; i < replacements.length; i++) {
                const p = replacements[i];
                data = data.replace(new RegExp(p.placeholder, "g"), p.value || p.placeholder);
              }
            }
            destPath.push(fileName + fileExtension);
            var destPathString = path.join(...destPath);
            if (context.projectSettings.placeholders) {
              for (let i = 0; i < context.projectSettings.placeholders.length; i++) {
                const p = context.projectSettings.placeholders[i];
                data = data.replace(new RegExp(p.placeholder, "g"), p.value || p.placeholder);
                destPathString = destPathString.replace(new RegExp(p.placeholder, "g"), p.value || p.placeholder);
              }
            }
            await vscode.workspace.fs.writeFile(vscode.Uri.file(destPathString), Buffer.from(data, "utf8"));
            if (openFile) {
              vscode.workspace.openTextDocument(vscode.Uri.file(destPathString)).then((doc) => {
                vscode.window.showTextDocument(doc);
              });
            }
          }
        }
      }
    }
  }
}
