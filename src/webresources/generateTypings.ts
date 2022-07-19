import * as vscode from "vscode";
import * as cp from "child_process";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function generateTypings(context: DataversePowerToolsContext) {
    vscode.window.showInformationMessage("Generating typings");
    if (vscode.workspace.workspaceFolders !== undefined) {
        const spklFile = await vscode.workspace.fs.readFile(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\spkl.json"));
        const spklString = Buffer.from(spklFile).toString("utf8");
        const spkl = JSON.parse(spklString);
        cp.execFile(
            vscode.workspace.workspaceFolders[0].uri.fsPath + ".\\packages\\Delegate.XrmDefinitelyTyped\\content\\XrmDefinitelyTyped\\XrmDefinitelyTyped.exe",
            [
                `/url:${context.connectionString.split(";")[1].replace("Url=", "")}/XRMServices/2011/Organization.svc`,
                `/out:typings\\XRM`,
                `/solutions:${spkl.webresources[0].solution}`,
                `/mfaAppId:${context.connectionString.split(";")[2].replace("ClientId=", "")}`,
                `/mfaReturnUrl:${context.connectionString.split(";")[1].replace("Url=", "")}`,
                `/mfaClientSecret:${context.connectionString.split(";")[3].replace("ClientSecret=", "")}`,
                `/jsLib:bin/cld_dependencies`,
                `/method:ClientSecret`,
                `/web:${spkl.webresources[0].solution}Web`,
                `/rest:${spkl.webresources[0].solution}Rest`,
            ],
            {
                cwd: vscode.workspace.workspaceFolders[0].uri.fsPath,
            },
            (error, stdout) => {
                if (error) {
                    vscode.window.showErrorMessage("Error creating types, see output for details.");
                    vscode.window.showErrorMessage(stdout);
                    vscode.window.showErrorMessage(error.message);
                    context.channel.appendLine(stdout);
                    context.channel.show();
                } else {
                    context.channel.appendLine(stdout);
                    vscode.window.showInformationMessage("Types have been generated.");
                }
            }
        );
    }
}
