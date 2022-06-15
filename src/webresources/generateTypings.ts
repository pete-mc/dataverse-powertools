import * as vscode from "vscode";
import * as cp from "child_process";
import DataversePowertoolsContext from "../DataversePowertoolsContext";

export async function generateTypings(context: DataversePowertoolsContext) {
    vscode.window.showInformationMessage("Generating typings");
    if (vscode.workspace.workspaceFolders !== undefined) {
        const connfile = await vscode.workspace.fs.readFile(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\connectionstring.txt"));
        const connString = Buffer.from(connfile).toString("utf8");
        const spklFile = await vscode.workspace.fs.readFile(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\spkl.json"));
        const spklString = Buffer.from(spklFile).toString("utf8");
        const spkl = JSON.parse(spklString);
        cp.execFile(
            vscode.workspace.workspaceFolders[0].uri.fsPath + ".\\packages\\Delegate.XrmDefinitelyTyped\\content\\XrmDefinitelyTyped\\XrmDefinitelyTyped.exe",
            [
                `/url:${connString.split(";")[1].replace("Url=", "")}/XRMServices/2011/Organization.svc`,
                `/out:typings\\XRM`,
                `/solutions:${spkl.webresources[0].solution}`,
                `/mfaAppId:${connString.split(";")[2].replace("ClientId=", "")}`,
                `/mfaReturnUrl:${connString.split(";")[1].replace("Url=", "")}`,
                `/mfaClientSecret:${connString.split(";")[3].replace("ClientSecret=", "")}`,
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
