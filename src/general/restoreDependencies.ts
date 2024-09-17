import * as vscode from "vscode";
import * as cp from "child_process";
import path = require("path");
import fs = require("fs");
import DataversePowerToolsContext, { PowertoolsTemplate, ProjectTypes, RestoreCommand } from "../context";

export async function restoreDependencies(context: DataversePowerToolsContext, initialising: boolean = false) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Restoring dependencies...",
    },
    async () => {
      if (!context.projectSettings.type) {
        vscode.window.showErrorMessage("No Template Found; Try reloading extension again");
        return;
      }
      const util = require("util");
      var fullFilePath = context.vscode.asAbsolutePath(path.join("templates", context.projectSettings.type));
      var templates = JSON.parse(fs.readFileSync(fullFilePath + "\\template.json", "utf8")) as Array<PowertoolsTemplate>;
      var templateToCopy = {} as PowertoolsTemplate;
      for (const t of templates) {
        if (t.version === context.projectSettings.templateversion) {
          templateToCopy = t;
          break;
        }
      }
      const stillRunning = false;
      context.template = templateToCopy;
      if (vscode.workspace.workspaceFolders !== undefined && context.template !== undefined && context.template.restoreCommands) {
        const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        let restoreCommands = initialising ? context.template?.initCommands || [] : context.template?.restoreCommands || [];
        for (const c of restoreCommands) {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Restoring " + c.command,
            },
            async () => {
              await restoreDepedencyExec(c.command, workspacePath, context);
            },
          );
        }
        context.channel.appendLine("Restore Complete.");
      } else {
        context.channel.appendLine("No Template Found; Try reloading extension again");
        vscode.window.showErrorMessage("No Template Found; Try reloading extension again");
      }
    }
  );
}

export async function restoreDepedencyExec(command: string, workspacePath: string, context: DataversePowerToolsContext) {
  const util = require("util");
  const exec = util.promisify(require("child_process").exec);
  if (vscode.workspace.workspaceFolders !== undefined) {
    const promise = exec(command, { cwd: workspacePath });
    const child = promise.child;

    child.stdout.on("data", function (data: any) {
      if (!data) {
        return;
      }
      if (data.includes("Error") && !data.includes("0 Error")) {
        vscode.window.showErrorMessage("Error restoring " + command + ". See output for details.");
        context.channel.appendLine(data);
        context.channel.show();
      } else if (data.includes("0 Error")) {
        context.channel.appendLine("Restore Complete."); 
        context.channel.appendLine(data);
        context.channel.show();
      } else {
        context.channel.appendLine(data);
        return stdout;
      }
    });

    child.stderr.on("data", function (data: any) {
      vscode.window.showErrorMessage("Error restoring " + command + ". See output for details.");
      context.channel.appendLine(data);
      context.channel.show();
    });

    child.on("close", function (_code: any) {
      return "success";
    });

    const { stdout, stderr } = await promise;
  }
}
