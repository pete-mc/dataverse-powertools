import * as vscode from "vscode";
import * as cp from "child_process";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function generateTypings(context: DataversePowerToolsContext) {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Generating Typings...",
  }, async () => {
    await generateTypingsExecution(context);
  });  
}

export async function generateTypingsExecution(context: DataversePowerToolsContext) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    const util = require('util');
    const exec = util.promisify(require('child_process').execFile);
    const spklFile = await vscode.workspace.fs.readFile(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\spkl.json"));
    const spklString = Buffer.from(spklFile).toString("utf8");
    const spkl = JSON.parse(spklString);
    const promise = exec(
      vscode.workspace.workspaceFolders[0].uri.fsPath + ".\\packages\\Delegate.XrmDefinitelyTyped\\content\\XrmDefinitelyTyped\\XrmDefinitelyTyped.exe",
      [
        `/url:${context.connectionString.split(";")[2].replace("Url=", "")}/XRMServices/2011/Organization.svc`,
        `/out:typings\\XRM`,
        `/solutions:${spkl.webresources[0].solution}`,
        `/mfaAppId:${context.connectionString.split(";")[3].replace("ClientId=", "")}`,
        `/mfaReturnUrl:${context.connectionString.split(";")[2].replace("Url=", "")}`,
        `/mfaClientSecret:${context.connectionString.split(";")[4].replace("ClientSecret=", "")}`,
        `/jsLib:bin/cld_dependencies`,
        `/method:ClientSecret`,
        `/web:${spkl.webresources[0].solution}Web`,
        `/rest:${spkl.webresources[0].solution}Rest`,
      ],
      {
        cwd: vscode.workspace.workspaceFolders[0].uri.fsPath,
      }
    );
    const child = promise.child; 
    // cp.execFile(
    //   ,
    //   (error, stdout) => {
    //     if (error) {
    //       vscode.window.showErrorMessage("Error creating types, see output for details.");
    //       vscode.window.showErrorMessage(stdout);
    //       vscode.window.showErrorMessage(error.message);
    //       context.channel.appendLine(stdout);
    //       context.channel.show();
    //     } else {
    //       context.channel.appendLine(stdout);
    //       vscode.window.showInformationMessage("Types have been generated.");
    //     }
    //   }
    // );
    child.stderr.on('data', function(data: any) {
      vscode.window.showInformationMessage("Error creating types, see output for details.");
    });
    child.on('close', function(code: any) {
      vscode.window.showInformationMessage("Typings have been generated.");
    });
    
    // i.e. can then await for promisified exec call to complete
    const { stdout, stderr } = await promise;
  }
}