import * as vscode from 'vscode';
import * as cp from "child_process";

import DataversePowerToolsContext from '../DataversePowertoolsContext';

export async function restoreDependencies(context: DataversePowerToolsContext) {
		const util = require('util');
		const execFile = util.promisify(cp.execFile);
		vscode.window.showInformationMessage('Restoring dependencies...');
		if (vscode.workspace.workspaceFolders !== undefined && context.template !== undefined) {
			const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
			const template = context.template;
			template.restoreCommands?.every((c)=>{
				const {error, stdout} = execFile(c.command, c.params, { cwd: workspacePath,  });
    		if (error) {
						vscode.window.showErrorMessage("Error running " + c.command + " " + c.params.join(" "));
						context.channel.appendLine(stdout);
						context.channel.show();
						return false;
					}
					else{
						context.channel.appendLine(stdout);
					}
			});
			vscode.window.showInformationMessage('Restore Complete.');
		};		
};
