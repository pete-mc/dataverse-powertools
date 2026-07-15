// Command: build the active TypeScript file into a Power Pages front-end web file
// (#150 #1). Runs esbuild to bundle it (npm deps + shared code inlined, tree-shaken,
// minified, source-mapped) into a single browser JS web file OOTB `pac powerpages
// upload` serves. Registered once, globally. Pure args in portalFrontendBuild.ts.
//
// Requires esbuild in the file's project (`npx esbuild`). Pre-release.

import * as vscode from "vscode";
import * as path from "path";
import * as util from "util";
import DataversePowerToolsContext from "../context";
import { esbuildFrontendArgs, frontendOutputName } from "./portalFrontendBuild";

const exec = util.promisify(require("child_process").exec);

export function registerPortalFrontendBuild(context: DataversePowerToolsContext): void {
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildPortalFrontend", () => buildActiveFile(context)));
}

async function buildActiveFile(context: DataversePowerToolsContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !/\.[cm]?tsx?$/i.test(editor.document.fileName)) {
    vscode.window.showInformationMessage("Open the portal front-end TypeScript file you want to build.");
    return;
  }

  await editor.document.save();
  const cwd = path.dirname(editor.document.fileName);
  const entry = path.basename(editor.document.fileName);
  const outFile = frontendOutputName(entry);

  context.channel.appendLine(`\nBuilding portal front-end: ${entry} → ${outFile}`);
  try {
    await exec(`npx esbuild ${esbuildFrontendArgs(entry, outFile).join(" ")}`, { cwd });
  } catch (error: unknown) {
    context.channel.appendLine(`esbuild failed: ${(error as { stderr?: string; message?: string }).stderr || (error as Error).message}`);
    context.channel.show(true);
    vscode.window.showErrorMessage("Portal front-end build failed (is esbuild installed in this project?). See the Dataverse PowerTools output.");
    return;
  }

  context.channel.appendLine(`Built ${outFile} (+ source map). Upload it as a web file with pac powerpages upload.`);
  vscode.window.showInformationMessage(`Built portal front-end web file: ${outFile}.`);
}
