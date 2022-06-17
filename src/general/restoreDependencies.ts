import * as vscode from 'vscode';
import * as cp from "child_process";

export async function restoreDependencies(chan: vscode.OutputChannel) {
		vscode.window.showInformationMessage('Restoring dependencies...');
		if (vscode.workspace.workspaceFolders !== undefined) {
			const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
			const connfile = await vscode.workspace.fs.readFile(vscode.Uri.file(workspacePath + "\\connectionstring.txt"));
			const connString = Buffer.from(connfile).toString('utf8');
			const codeType = "plugin"; //get environment variable

			try{
			var blah = cp.execSync("ping asdasd");
			chan.appendLine(blah.toString());
			}
			catch(e){
				chan.appendLine("Error: " + e);
			}
			
			chan.appendLine("before");
			//var blah = await CommonRestore(chan, workspacePath);
			switch (codeType) 
			{
				case "plugin":
					await PluginRestore(chan, workspacePath);
					break;
				// case "webresource":
				// 	WebresourceRestore(chan, workspacePath);
				// 	break;
			}
		};		
};

async function CommonRestore(chan: vscode.OutputChannel, workspacePath: string): Promise<number | null> {
	chan.append("\ndotnet new tool-manifest");
	var blah = await cp.execFile("dotnet", ["new", "tool-manifest", "--force"], {cwd: workspacePath},
	async (error, stdout) => {
		if (error) {
			vscode.window.showErrorMessage("Error restoring tool-manifest, see output for details.");
			chan.appendLine(stdout);
			chan.show();
		}	else{
			chan.appendLine(stdout);

			chan.append("\ndotnet tool restore");
			await cp.execFile("dotnet", ["tool", "restore"], {cwd: workspacePath}
			,async (error, stdout) => {
				if (error) {
					vscode.window.showErrorMessage("Error restoring tool restore, see output for details.");
					chan.appendLine(stdout);
					chan.show();
				}	else{
					chan.appendLine(stdout);

					chan.append("\ndotnet tool install paket");
					await cp.execFile("dotnet", ["tool", "install", "paket"], {cwd: workspacePath}
					,async (error, stdout) => {
						if (error) {
							vscode.window.showErrorMessage("Error restoring tool install paket, see output for details.");
							chan.appendLine(stdout);
							chan.show();
						}	else{
							chan.appendLine(stdout);
		
							chan.append("\ndotnet paket install");
							await cp.execFile("dotnet", ["paket","install"], {cwd: workspacePath}
							,(error, stdout) => {
								if (error) {
									vscode.window.showErrorMessage("Error restoring paket install, see output for details.");
									chan.appendLine(stdout);
									chan.show();
								}	else{
									chan.appendLine(stdout);
								}
							});
						}
					});
				}
			});
		}
	});
	
chan.appendLine("Function complete.");
return blah.exitCode;
}

async function PluginRestore(chan: vscode.OutputChannel, workspacePath: string)
{
	chan.append("\ndotnet restore");
	cp.execFile("dotnet", ["restore"], {cwd: workspacePath}
	,(error, stdout) => {
		if (error) {
			vscode.window.showErrorMessage("Error restoring dotnet, see output for details.");
			chan.appendLine(stdout);
			chan.show();
		}	else{
			chan.appendLine(stdout);

			chan.append("\ndotnet paket init");
			cp.execFile("dotnet", ["paket init"], {cwd: workspacePath}
			,(error, stdout) => {
				if (error) {
					vscode.window.showErrorMessage("Error restoring paket init, see output for details.");
					chan.appendLine(stdout);
					chan.show();
				}	else{
					chan.appendLine(stdout);
				}
			});
		}
	});

}

async function WebresourceRestore(chan: vscode.OutputChannel, workspacePath: string)
{
	cp.execFile("\nnpm", ["install"], {cwd: workspacePath}
	, (error, stdout) => {
		if (error) {
			vscode.window.showErrorMessage("Error restoring npm, see output for details.");
			chan.appendLine(stdout);
			chan.show();
		}	else{
			chan.appendLine(stdout);
		}
	});
}