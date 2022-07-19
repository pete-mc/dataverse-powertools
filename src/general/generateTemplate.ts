import * as vscode from 'vscode';
import * as cp from "child_process";
import DataversePowerToolsContext, { ProjectTypes } from "../DataversePowerToolsContext";

export async function generatTemplate(context: DataversePowerToolsContext) {
    vscode.window.showInformationMessage("Generating");
    if (vscode.workspace.workspaceFolders !== undefined) {
        const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        cp.execFile("dotnet", ["new", "console"], { cwd: workspacePath }, (error, stdout) => {
            if (error) {
                vscode.window.showErrorMessage("Error generating template, see output for details.");
                context.channel.appendLine(stdout);
                context.channel.show();
            } else {
                context.channel.appendLine(stdout);
                vscode.window.showInformationMessage("Generated");
            }
        });
    }
}