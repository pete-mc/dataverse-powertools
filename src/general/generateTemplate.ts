import * as vscode from 'vscode';
import * as cp from "child_process";
import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes } from "../DataversePowerToolsContext";
import path = require("path");
import fs = require("fs");

export async function generateTemplate(context: DataversePowerToolsContext) {
    vscode.window.showInformationMessage("Generating");
    if(context.projectSettings.type && context.projectSettings.templateversion && vscode.workspace.workspaceFolders)
    {
        var fullFilePath = context.vscode.asAbsolutePath(path.join(context.projectSettings.type));
        var templates = JSON.parse(fs.readFileSync(fullFilePath + "\\template.json", "utf8")) as Array<PowertoolsTemplate>;
        var templateToCopy = {} as PowertoolsTemplate;
        templates.every((t)=>{
            if(t.version === context.projectSettings.templateversion)
            {
                templateToCopy = t;
                return false;
            }
        });
        if(templateToCopy)
        {
            templateToCopy.files?.every(async (f)=>{
                var data = fs.readFileSync(fullFilePath + "\\" + f, "utf8");
                templateToCopy.placeholders?.every(async (p)=>{
                    var value = await vscode.window.showInputBox({
                        prompt: p.displayName,}) as string;
                    data = data.replace(p.placeholder, value);
                });
                if(vscode.workspace.workspaceFolders){
                    const folderPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
                    const path = f.path;
                    path.unshift(folderPath);
                    await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(...path)), Buffer.from(data, "utf8"));
                }
            });
        }
    }
}