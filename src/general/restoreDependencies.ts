import * as vscode from 'vscode';
import * as cp from "child_process";
import path = require("path");
import fs = require("fs");

import DataversePowerToolsContext, { PowertoolsTemplate } from '../DataversePowertoolsContext';

export async function restoreDependencies(context: DataversePowerToolsContext) {
  const util = require('util');
  const execFile = util.promisify(cp.exec);
  vscode.window.showInformationMessage('Restoring dependencies...');
  if (context.projectSettings.type && context.projectSettings.templateversion && vscode.workspace.workspaceFolders) {
    if (vscode.workspace.workspaceFolders !== undefined && context.projectSettings.templateversion && vscode.workspace.workspaceFolders) {
      var fullFilePath = context.vscode.asAbsolutePath(path.join("templates", context.projectSettings.type));
      var templates = JSON.parse(fs.readFileSync(fullFilePath + "\\template.json", "utf8")) as Array<PowertoolsTemplate>;
      var templateToCopy = {} as PowertoolsTemplate;
      for (const t of templates) {
        if (t.version === context.projectSettings.templateversion) {
          templateToCopy = t;
          break;
        }
      }

      if (templateToCopy && templateToCopy.placeholders) {
        const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const template = context.template;
				// cp.exec(
				// 	"mkdir ASfiughseif",
				// 	{
				// 		cwd: workspacePath
				// 	},
				// 	(error, stdout) => {
				// 		if (error) {
				// 			vscode.window.showErrorMessage("Error creating earlyboud types, see output for details.");
				// 			context.channel.appendLine(stdout);
				// 			context.channel.show();
				// 		} else {
				// 			context.channel.appendLine(stdout);
				// 		}
				// 	}
				// );
				for (const c of templateToCopy.restoreCommands || []) {
					const {error, stdout} = await execFile(c.command, { cwd: workspacePath });
          if (error) {
            vscode.window.showErrorMessage("Error running " + c.command + " " + c.params.join(" "));
            context.channel.appendLine(stdout);
            context.channel.show();
            return false;
          }
          else {
						vscode.window.showInformationMessage("Successfully ran: " + c.command);
            context.channel.appendLine(stdout);
          }				
				}
        templateToCopy.restoreCommands?.every((c) => {
					// cp.exec(c.command, { cwd: workspacePath },
					// 	(error, stdout) => {
					// 		if (error) {
					// 				vscode.window.showErrorMessage("Error creating types, see output for details.");
					// 				vscode.window.showErrorMessage(stdout);
					// 				vscode.window.showErrorMessage(error.message);
					// 				context.channel.appendLine(stdout);
					// 				context.channel.show();
					// 		} else {
					// 				context.channel.appendLine(stdout);
					// 				vscode.window.showInformationMessage("Types have been generated.");
					// 		}
					// 	}
					// );


        });
        vscode.window.showInformationMessage('Restore Complete.');
      }
    };
  }

};
