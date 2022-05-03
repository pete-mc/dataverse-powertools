import * as vscode from 'vscode';
import * as cp from "child_process";

export async function buildDeployWorkflow(chan: vscode.OutputChannel) {
		vscode.window.showInformationMessage('Building');
		if (vscode.workspace.workspaceFolders !== undefined) {
			const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
			const connfile = await vscode.workspace.fs.readFile(vscode.Uri.file(workspacePath + "\\connectionstring.txt"));
			const connString = Buffer.from(connfile).toString('utf8');
			cp.execFile("dotnet",["build"],{cwd: workspacePath}
				,(error, stdout) => {
					if (error) {
						vscode.window.showErrorMessage("Error building Workflows, see output for details.");
						chan.appendLine(stdout);
						chan.show();
					}	else{
						chan.appendLine(stdout);
						vscode.window.showInformationMessage('Deploying to Dataverse');
						cp.execFile(
							workspacePath + "\\packages\\spkl\\tools\\spkl.exe",
							[
								"workflow",
								"./RWFCore/spkl.json",
								connString
							],
							{
								cwd: workspacePath
							}
							,(error, stdout) => {
								if (error) {
									vscode.window.showErrorMessage("Error deploying Workflow, see output for details.");
									chan.appendLine(stdout);
									chan.show();
								}	else{
									chan.appendLine(stdout);
									vscode.window.showInformationMessage('Workflow Deployed');
								}
							});
					}
				});

			
		};		
};
