import * as vscode from 'vscode';
import * as cp from "child_process";
import * as path from 'path';
import * as fs from 'fs';

export async function buildDeployPlugin(chan: vscode.OutputChannel, context: vscode.ExtensionContext) {
		vscode.window.showInformationMessage('Building');
  	if (vscode.workspace.workspaceFolders !== undefined) {
			const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
			const connfile = await vscode.workspace.fs.readFile(vscode.Uri.file(workspacePath + "\\connectionstring.txt"));
			const connString = Buffer.from(connfile).toString('utf8');
			cp.execFile("dotnet",["build"],{cwd: workspacePath}
				,(error, stdout) => {
					if (error) {
						vscode.window.showErrorMessage("Error building plugins, see output for details.");
						chan.appendLine(stdout);
						chan.show();
					}	else{
						chan.appendLine(stdout);
						vscode.window.showInformationMessage('Deploying to Dataverse');
						cp.execFile(
							workspacePath + "\\packages\\spkl\\tools\\spkl.exe",
							[
								"plugins",
								"./RWFCore/spkl.json",
								connString
							],
							{
								cwd: workspacePath
							}
							,(error, stdout) => {
								if (error) {
									vscode.window.showErrorMessage("Error deploying plugin, see output for details.");
									chan.appendLine(stdout);
									chan.show();
								}	else{
									chan.appendLine(stdout);
									vscode.window.showInformationMessage('Plugin Deployed');
								}
							});
					}
				});

			
		};		
};
