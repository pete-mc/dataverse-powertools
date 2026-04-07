import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import * as path from "path";
import { DataverseWebresource } from "../general/dataverse/DataverseWebresource";

export async function deployWebresources(context: DataversePowerToolsContext) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Building Resources...",
    },
    async () => {
      await buildAndDeployExec(context);
    },
  );
}

export async function buildAndDeployExec(context: DataversePowerToolsContext) {
  if (vscode.workspace.workspaceFolders !== undefined) {
    const util = require("util");
    const exec = util.promisify(require("child_process").exec);
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const promiseBuild = exec("webpack --config webpack.dev.js", { cwd: workspacePath });
    const childBuild = promiseBuild.child;
    let error = false;

    childBuild.stderr.on("data", function (data: any) {
      vscode.window.showInformationMessage("Error building webresources, see output for details.");
      error = true;
      context.channel.appendLine(data);
      context.channel.show();
    });

    childBuild.stdout.on("data", function (data: any) {
      const output = data.replace(/\\[\d+m/g, "");
      if (output.includes("ERROR")) {
        context.channel.appendLine(output);
        vscode.window.showInformationMessage("Error building webresources, see output for details.");
        error = true;
        context.channel.show();
      }
      context.channel.appendLine(output);
    });

    childBuild.on("close", function (_code: any) {
      if (!error) {
        vscode.window.showInformationMessage("Building Complete");
        deploy(context);
      }
    });
    const { stdout, stderr } = await promiseBuild;
  }
}

export async function deploy(context: DataversePowerToolsContext) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Deploying Resources...",
    },
    async () => {
      if (vscode.workspace.workspaceFolders === undefined) {
        return;
      }

      try {
        if (!context.dataverse.isValid) {
          const initialized = await context.dataverse.initialize();
          if (!initialized) {
            vscode.window.showErrorMessage("Error deploying webresources, Dataverse connection is not valid.");
            return;
          }
        }

        const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const binPath = path.join(workspacePath, "bin");
        const filesToDeploy = await vscode.workspace.findFiles("bin/**", "**/{node_modules,.git}/**");
        const solutionUniqueName = context.projectSettings.webresourceSolutionName || context.projectSettings.solutionName;

        if (filesToDeploy.length === 0) {
          vscode.window.showWarningMessage("No built webresources found in the bin folder.");
          return;
        }

        let deployedCount = 0;

        for (const file of filesToDeploy) {
          const relativePath = path.relative(binPath, file.fsPath);
          if (!relativePath || relativePath.startsWith("..")) {
            continue;
          }

          const extension = path.extname(relativePath).toLowerCase();
          const webresourceType = DataverseWebresource.mapWebresourceType(extension);
          if (webresourceType === undefined) {
            context.channel.appendLine(`Skipping unsupported webresource type: ${relativePath}`);
            continue;
          }

          const contentBuffer = await vscode.workspace.fs.readFile(file);
          const contentBase64 = Buffer.from(contentBuffer).toString("base64");
          const name = relativePath.replace(/\\/g, "/");

          const webresource = new DataverseWebresource(name, context);
          await webresource.upsert(contentBase64, webresourceType, path.basename(name));
          if (solutionUniqueName) {
            await webresource.addToSolution(solutionUniqueName);
          }
          deployedCount += 1;
          context.channel.appendLine(`Deployed webresource: ${name}`);
        }

        if (!solutionUniqueName) {
          context.channel.appendLine("No webresource solution configured in settings; skipped adding webresources to a solution.");
        }
        vscode.window.showInformationMessage(`Publishing customizations...`);
        context.channel.appendLine(`Webresource deployment complete, upserted ${deployedCount} webresources. Publishing customizations...`);
        await context.dataverse.publishAllCustomisations();
        vscode.window.showInformationMessage(`Deploy Complete (${deployedCount} webresources upserted)`);
      } catch (e: any) {
        context.channel.appendLine(e?.message || JSON.stringify(e));
        context.channel.show();
        vscode.window.showErrorMessage("Error deploying webresources, see output for details.");
      }
    },
  );
}
