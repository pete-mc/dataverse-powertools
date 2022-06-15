import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import DataversePowertoolsContext from "../DataversePowertoolsContext";

export async function buildWebresources(context: DataversePowertoolsContext) {
    vscode.window.showInformationMessage("Building");
    if (vscode.workspace.workspaceFolders !== undefined) {
        const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        cp.exec("webpack --config webpack.dev.js", { cwd: workspacePath }, (error, stdout) => {
            if (error) {
                vscode.window.showErrorMessage("Error building webresources, see output for details.");
                context.channel.appendLine(stdout);
                context.channel.appendLine(error.message);
                context.channel.show();
            } else {
                context.channel.appendLine(stdout);
                vscode.window.showInformationMessage("Building Complete");
            }
        });
    }
}
