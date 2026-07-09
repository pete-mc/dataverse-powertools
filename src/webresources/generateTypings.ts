import * as vscode from "vscode";
import * as fs from "fs";
import DataversePowerToolsContext from "../context";
import { workspaceFilePath } from "../general/paths";
import { parseConnectionString, normalizeOrganizationUrl } from "../general/connectionString";

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
    const parts = parseConnectionString(context.connectionString);
    const orgUrl = normalizeOrganizationUrl(parts.url);
    const defTypedOptions = [
      `/url:${orgUrl}/XRMServices/2011/Organization.svc`,
      `/out:typings\\XRM`,
      `/ss:${context.projectSettings.solutionName}`,
      `/mfaAppId:${parts.clientId ?? ""}`,
      `/mfaReturnUrl:${orgUrl}`,
      `/mfaClientSecret:${parts.clientSecret ?? ""}`,
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

    const executablePath = workspaceFilePath(
      vscode.workspace.workspaceFolders[0].uri.fsPath,
      "packages",
      "Delegate.XrmDefinitelyTyped",
      "content",
      "XrmDefinitelyTyped",
      "XrmDefinitelyTyped.exe",
    );

    if (!fs.existsSync(executablePath)) {
      context.channel.appendLine(`XrmDefinitelyTyped was not found at ${executablePath}.`);
      context.channel.appendLine(
        "It is restored from the Delegate.XrmDefinitelyTyped NuGet package via paket. Run the project restore (dotnet tool restore && dotnet paket install), or recreate the project so the paket dependency is present.",
      );
      context.channel.appendLine("Note: XrmDefinitelyTyped is a Windows-only .NET Framework tool, so typings generation currently requires Windows.");
      context.channel.show();
      vscode.window.showErrorMessage("XrmDefinitelyTyped is not installed. See the Dataverse PowerTools output for how to restore it.");
      return;
    }

    try {
      const promise = exec(executablePath, defTypedOptions, {
        cwd: vscode.workspace.workspaceFolders[0].uri.fsPath,
      });
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
