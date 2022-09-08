import * as vscode from "vscode";
import * as cp from "child_process";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function generateEarlyBound(context: DataversePowerToolsContext) {
  // await vscode.window.withProgress<string>({
  //     location: vscode.ProgressLocation.Notification,
  //     title: "Generating early bound classes...",
  // }, async () => {
  //     return new Promise(resolve => setTimeout(resolve, 5000))
  // });
  // vscode.window.showInformationMessage("Generating early bound classes from spkl.json");
  if (vscode.workspace.workspaceFolders !== undefined) {
    const solutionName = "plugins_src"
    const spklFile = await vscode.workspace.fs.readFile(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + solutionName + "\\spkl.json"));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\" + solutionName + "\\generated"));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\logs"));
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Generating early bound classes...",
    }, async () => {
      await runFile(context, solutionName);
    });
  }
}

export async function testAsyncFunction() {
  return new Promise(resolve => setTimeout(resolve, 5000));
}
export async function runFile(context: DataversePowerToolsContext, solutionName: string) {
  const util = require('util');
  const exec = util.promisify(require('child_process').execFile);
  if (vscode.workspace.workspaceFolders !== undefined) {

    const promise = exec(
      vscode.workspace.workspaceFolders[0].uri.fsPath + "\\packages\\spkl\\tools\\spkl.exe",
      ["earlybound", "../" + solutionName + "/spkl.json", context.connectionString],
      {
        cwd: vscode.workspace.workspaceFolders[0].uri.fsPath + "\\logs",
      }
    );
    const child = promise.child; 

    child.stdout.on('data', function(data: any) {
      console.log('stdout: ' + data);
    });
    child.stderr.on('data', function(data: any) {
      console.log('stderr: ' + data);
    });
    child.on('close', function(code: any) {
      vscode.window.showInformationMessage("Earlybound types have been generated.");
    });
    
    // i.e. can then await for promisified exec call to complete
    const { stdout, stderr } = await promise;
    // await cp.execFile(,
    //   (error, stdout) => {
    //     if (error) {
    //       vscode.window.showErrorMessage("Error creating earlyboud types, see output for details.");
    //       context.channel.appendLine(stdout);
    //       vscode.window.showErrorMessage(error.message);
    //       context.channel.show();
    //       return 'error';
    //     } else {
    //       context.channel.appendLine(stdout);
    //       vscode.window.showInformationMessage("Earlybound types have been generated.");
    //       return 'done';
    //     }
    //   }
    // );
  }
}
