import * as vscode from "vscode";
import * as cp from "child_process";
import DataversePowerToolsContext from "../context";
import { window } from "vscode";

export async function connectPortal(context: DataversePowerToolsContext, command: string) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Connecting Portal...",
    },
    async () => {
      await getPACLocation(context, command);
    },
  );
}

export async function getPACLocation(context: DataversePowerToolsContext, command: string) {
  const util = require("util");
  const exec = util.promisify(require("child_process").exec);
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;

    const whereCommand = "where pac";
    const wherePromise = exec(whereCommand);

    const whereChild = wherePromise.child;

    whereChild.stdout.on("data", function (data: any) {
      const location = data.replace("\r\n", "");
      if (location !== null && location !== "") {
        connectPortalExec(context, location, command);
      }
    });

    whereChild.stderr.on("data", function (data: any) {
      context.channel.appendLine(data);
      context.channel.show();
    });

    whereChild.on("close", function (_code: any) {
      return "success";
    });

    // i.e. can then await for promisified exec call to complete
    const { stdout, stderr } = await wherePromise;
  }
}

export async function createPACConnection(context: DataversePowerToolsContext, _pacLocation: string, command: string) {
  const util = require("util");
  const exec = util.promisify(require("child_process").exec);
  if (vscode.workspace.workspaceFolders !== undefined) {
    cp.exec(command, (error, stdout) => {
      if (error) {
        vscode.window.showErrorMessage("Error creating auth.");
        context.channel.appendLine(error.message);
        context.channel.show();
      } else {
        if (stdout !== null && stdout !== "") {
          context.channel.appendLine(stdout);
          context.channel.show();
        }
      }
    });
  }
}

export async function connectPortalExec(context: DataversePowerToolsContext, pacLocation: string, _command: string) {
  const util = require("util");
  const exec = util.promisify(require("child_process").exec);
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const authlistCommand = pacLocation + " auth list";
    cp.exec(authlistCommand, (error, stdout) => {
      if (error) {
        vscode.window.showErrorMessage("Error finding Portals.");
        context.channel.appendLine(error.message);
        context.channel.show();
      } else {
        if (stdout !== null && stdout !== "") {
          let connectionStringSplit = context.connectionString.substring(context.connectionString.indexOf("Url=") + 4, context.connectionString.length - 1);
          let name = connectionStringSplit.split(";")[0];
          const arrayOfString = stdout.replace(/\s\s+/g, " ").split(" ");
          const indexOfName = arrayOfString.findIndex((x) => x.includes(name)) - 1;
          const nameOfPortal = arrayOfString[indexOfName];
          context.channel.appendLine(nameOfPortal);
          context.channel.show();
          context.channel.appendLine(stdout);
          if (nameOfPortal === null) {
            vscode.window.showErrorMessage("Error finding matching portal.");
            createPACConnection(context, pacLocation, "pac auth create --url " + name);
          } else {
            selectEnvironment(context, pacLocation, nameOfPortal);
          }
        }
      }
    });
  }
}

export async function selectEnvironment(context: DataversePowerToolsContext, pacLocation: string, name: string) {
  const util = require("util");
  const exec = util.promisify(require("child_process").exec);
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const authlistCommand = pacLocation + " auth select -n " + name;
    cp.exec(authlistCommand, (error, stdout) => {
      if (error) {
        vscode.window.showErrorMessage("Error finding Portals.");
        context.channel.appendLine(error.message);
        context.channel.show();
      } else {
        if (stdout !== null && stdout !== "") {
          let connectionStringSplit = context.connectionString.substring(context.connectionString.indexOf("Url=") + 4, context.connectionString.length - 1);
          let name = connectionStringSplit.split(";")[0];
          const arrayOfString = stdout.replace(/\s\s+/g, " ").split(" ");
          const indexOfName = arrayOfString.findIndex((x) => x === name) - 1;
          const nameOfPortal = arrayOfString[indexOfName];
          context.channel.appendLine(nameOfPortal);
          context.channel.show();
          const authlistCommand = pacLocation + " auth list";
          cp.exec(authlistCommand, (error, stdout) => {
            if (error) {
              vscode.window.showErrorMessage("Error finding Portals.");
              context.channel.appendLine(error.message);
              context.channel.show();
            } else {
              if (stdout !== null && stdout !== "") {
                context.channel.appendLine(nameOfPortal);
                context.channel.show();
                context.channel.appendLine(stdout);
                downloadPortal(context, pacLocation);
              }
            }
          });
        }
      }
    });
  }
}

export async function downloadPortal(context: DataversePowerToolsContext, pacLocation: string) {
  const util = require("util");
  const exec = util.promisify(require("child_process").exec);
  if (vscode.workspace.workspaceFolders !== undefined) {
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const authlistCommand = pacLocation + " paportal list";
    cp.exec(authlistCommand, async (error, stdout) => {
      if (error) {
        vscode.window.showErrorMessage("Error finding Portals.");
        context.channel.appendLine(error.message);
        context.channel.show();
      } else {
        if (stdout !== null && stdout !== "") {
          const arrayOfString = stdout.replace(/\s\s+/g, "\r").split("\r");
          const indexBeforeInformation = arrayOfString.findIndex((x) => x === "Friendly Name") + 1;
          let quickPickArray = [];
          for (let i = indexBeforeInformation; i <= arrayOfString.length - 2; i += 3) {
            quickPickArray.push({ label: arrayOfString[i + 2], target: arrayOfString[i + 1] });
          }
          const result = await window.showQuickPick(quickPickArray, { placeHolder: "Select a CRM/Dynamics Solution." });
          context.channel.appendLine(result?.label || "" + ", " + result?.target || "");
          const authlistCommand = pacLocation + " paportal download -id " + result?.target + " -p " + '"' + workspacePath + '\\portalpublish"';
          if (vscode.workspace.workspaceFolders !== undefined) {
            cp.exec(authlistCommand, async (error, stdout) => {
              if (error) {
                vscode.window.showErrorMessage("Error finding Portals.");
                context.channel.appendLine(error.message);
                context.channel.show();
              } else {
                if (stdout !== null && stdout !== "") {
                  context.channel.appendLine(stdout);
                  context.channel.show();
                }
              }
            });
            context.channel.show();
            context.channel.appendLine(stdout);
          }
        }
      }
    });
  }
}
