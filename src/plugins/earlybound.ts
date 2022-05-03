import * as vscode from 'vscode';
import * as cp from "child_process";

export async function generateEarlyBound(chan: vscode.OutputChannel) {
		vscode.window.showInformationMessage('Generating early bound classes from spkl.json');
		if (vscode.workspace.workspaceFolders !== undefined) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\RWFCore\\generated"));
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\logs"));
			const connfile = await vscode.workspace.fs.readFile(vscode.Uri.file(vscode.workspace.workspaceFolders[0].uri.fsPath + "\\connectionstring.txt"));
			const connString = Buffer.from(connfile).toString('utf8');
			cp.execFile(
				vscode.workspace.workspaceFolders[0].uri.fsPath + "\\packages\\spkl\\tools\\spkl.exe",
				[
					"earlybound",
					"../RWFCore/spkl.json",
					connString
				],
				{
					cwd: vscode.workspace.workspaceFolders[0].uri.fsPath + "\\logs"
				}
				,(error, stdout) => {
					if (error) {
						vscode.window.showErrorMessage("Error creating earlyboud types, see output for details.");
						chan.appendLine(stdout);
						chan.show();
					}	else{
						chan.appendLine(stdout);
						vscode.window.showInformationMessage('Earlybound types have been generated.');
					}
				});
		};		
};

