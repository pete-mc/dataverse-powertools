import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";

export async function generateTypings(context: DataversePowerToolsContext) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating Typings...",
    },
    async () => {
      await generateTypingsExecution(context);
    },
  );
}

export async function generateTypingsExecution(context: DataversePowerToolsContext) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    const util = require("util");
    const exec = util.promisify(require("child_process").execFile);
    const defTypedOptions = [
      `/url:${context.connectionString.split(";")[2].replace("Url=", "")}/XRMServices/2011/Organization.svc`,
      `/out:typings\\XRM`,
      `/ss:${context.projectSettings.solutionName}`,
      `/mfaAppId:${context.connectionString.split(";")[3].replace("ClientId=", "")}`,
      `/mfaReturnUrl:${context.connectionString.split(";")[2].replace("Url=", "")}`,
      `/mfaClientSecret:${context.connectionString.split(";")[4].replace("ClientSecret=", "")}`,
      `/jsLib:webresources_src\\lib`,
      `/method:ClientSecret`,
      `/w:${context.projectSettings.solutionName}Web`,
      `/r:${context.projectSettings.solutionName}Rest`,
    ];

    if (context.projectSettings.formIntersect !== undefined && context.projectSettings.formIntersect.length > 0) {
      //format: MyAccountIntersect: b053a39a-041a-4356-acef-ddf00182762b;a72c7955-442b-4ea4-9499-b10cd18b4256
      defTypedOptions.push(
        `/fi:${context.projectSettings.formIntersect
          .map((intersect) => {
            return intersect.name + ": " + intersect.forms.map((form) => form.formId).join(";");
          })
          .join(" ")}`,
      );
    }

    try {
      const promise = exec(
        vscode.workspace.workspaceFolders[0].uri.fsPath + ".\\packages\\Delegate.XrmDefinitelyTyped\\content\\XrmDefinitelyTyped\\XrmDefinitelyTyped.exe",
        defTypedOptions,
        {
          cwd: vscode.workspace.workspaceFolders[0].uri.fsPath,
        },
      );
      const child = promise.child;
      child.stdout.on("data", function (data: any) {
        context.channel.appendLine(data);
      });
      child.stderr.on("data", function (_data: any) {
        vscode.window.showInformationMessage("Error creating types, see output for details.");
      });
      child.on("close", function (_code: any) {
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
