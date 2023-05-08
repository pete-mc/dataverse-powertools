import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";

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
    try {
      const promise = exec(
        vscode.workspace.workspaceFolders[0].uri.fsPath + ".\\packages\\Delegate.XrmDefinitelyTyped\\content\\XrmDefinitelyTyped\\XrmDefinitelyTyped.exe",
        [
          `/url:${context.connectionString.split(";")[2].replace("Url=", "")}/XRMServices/2011/Organization.svc`,
          `/out:typings\\XRM`,
          `/solutions:${spkl.webresources[0].solution}`,
          `/mfaAppId:${context.connectionString.split(";")[3].replace("ClientId=", "")}`,
          `/mfaReturnUrl:${context.connectionString.split(";")[2].replace("Url=", "")}`,
          `/mfaClientSecret:${context.connectionString.split(";")[4].replace("ClientSecret=", "")}`,
          `/jsLib:bin/${context.projectSettings.prefix}_dependencies`,
          `/method:ClientSecret`,
          `/web:${spkl.webresources[0].solution}Web`,
          `/rest:${spkl.webresources[0].solution}Rest`,
        ],
        {
          cwd: vscode.workspace.workspaceFolders[0].uri.fsPath,
        }
      );
      const child = promise.child; 
      child.stdout.on('data', function (data: any) {
        console.log('stdout: ' + data);
      });
      child.stderr.on('data', function(_data: any) {
        vscode.window.showInformationMessage("Error creating types, see output for details.");
      });
      child.on('close', function(_code: any) {
        vscode.window.showInformationMessage("Typings have been generated.");
      });
      
      // i.e. can then await for promisified exec call to complete
      const { stdout, stderr } = await promise;
    } catch (error: any) {
      vscode.window.showInformationMessage("Error creating types, see output for details.");
      context.channel.appendLine(error.message);
      context.channel.show();
      console.log(error);
    }
  }
}