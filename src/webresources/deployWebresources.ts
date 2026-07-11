import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import * as path from "path";
import { DataverseWebresource } from "../general/dataverse/DataverseWebresource";
import { runWebresourceBuild } from "./webpackBuild";
import { saveFormDataExec } from "./saveFormData";
import { activeComponentRoot } from "../components/componentDiscovery";

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
  const built = await runWebresourceBuild(context);
  if (!built) {
    return;
  }
  // Publish-all is deferred to a single call at the end: once after upload and
  // again after form registration was two full publishes per deploy.
  const deployed = await deploy(context, { publish: false });
  if (!deployed) {
    return;
  }
  // Deploy subsumes Register Form Events: handlers reference the deployed web
  // resource, so deploy-then-register is the only order that always works (the
  // standalone command failed with 0x8004F036 when run before a deploy — #90).
  // Silent when the project has no RegisterEvent decorations.
  let registered = false;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Registering form events...",
    },
    async () => {
      try {
        registered = await saveFormDataExec(context, { publish: false });
      } catch (e: any) {
        vscode.window.showErrorMessage(e?.message || "Error registering events.");
        context.channel.show();
      }
    },
  );
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Publishing customizations...",
    },
    async () => {
      context.channel.appendLine("Publishing all customizations...");
      await context.dataverse.publishAllCustomisations();
      context.channel.appendLine("Publish Complete");
      vscode.window.showInformationMessage(registered ? "Deploy complete — web resources published and form events registered." : "Deploy complete — web resources published.");
    },
  );
}

/** Deploy everything in bin/. Returns true only when the deploy actually completed.
 * Pass publish:false to defer publish-all to the caller (buildAndDeployExec). */
export async function deploy(context: DataversePowerToolsContext, options?: { publish?: boolean }): Promise<boolean> {
  const publish = options?.publish !== false;
  let succeeded = false;
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

        const workspacePath = activeComponentRoot(context) ?? vscode.workspace.workspaceFolders[0].uri.fsPath;
        const binPath = path.join(workspacePath, "bin");
        const filesToDeploy = await vscode.workspace.findFiles(new vscode.RelativePattern(workspacePath, "bin/**"), "**/{node_modules,.git}/**");
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
        context.channel.appendLine(`Webresource deployment complete, upserted ${deployedCount} webresources.`);
        if (publish) {
          vscode.window.showInformationMessage(`Publishing customizations...`);
          await context.dataverse.publishAllCustomisations();
          vscode.window.showInformationMessage(`Deploy Complete (${deployedCount} webresources upserted)`);
        }
        succeeded = true;
      } catch (e: any) {
        context.channel.appendLine(e?.message || JSON.stringify(e));
        context.channel.show();
        vscode.window.showErrorMessage("Error deploying webresources, see output for details.");
      }
    },
  );
  return succeeded;
}
