import * as vscode from "vscode";
import * as cp from "child_process";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function generateEarlyBound(context: DataversePowerToolsContext) {
    vscode.window.showInformationMessage("Generating early bound classes from spkl.json");
    if (vscode.workspace.workspaceFolders !== undefined) {
        const solutionName = "plugins_src"
        const spklFile = await vscode.workspace.fs.readFile(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + solutionName +"\\spkl.json"));
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + solutionName + "\\generated"));
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\logs"));
        cp.execFile(
            vscode.workspace.workspaceFolders[0].uri.fsPath + "\\packages\\spkl\\tools\\spkl.exe",
            ["earlybound", "../" + solutionName + "/spkl.json", context.connectionString],
            {
                cwd: vscode.workspace.workspaceFolders[0].uri.fsPath + "\\logs",
            },
            (error, stdout) => {
                if (error) {
                     vscode.window.showErrorMessage("Error creating earlyboud types, see output for details.");
                    context.channel.appendLine(stdout);
                    vscode.window.showErrorMessage(error.message);
                    context.channel.show();
                } else {
                    context.channel.appendLine(stdout);
                    vscode.window.showInformationMessage("Earlybound types have been generated.");
                }
            }
        );
    }
}
