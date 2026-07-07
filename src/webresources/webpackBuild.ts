import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { stripAnsi, buildOutputHasErrors } from "./buildOutput";

/**
 * Runs the webresource webpack build and resolves to `true` on success.
 *
 * Replaces the previous pattern that wired up stdout/stderr `data` listeners and
 * invoked deploy from a detached `close` handler: build success is now decided by
 * the process exit code (a rejected promise) plus an "ERROR in" scan of the output,
 * and the caller can safely `await` this before deploying.
 */
export async function runWebresourceBuild(context: DataversePowerToolsContext): Promise<boolean> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return false;
  }

  const util = require("util");
  const exec = util.promisify(require("child_process").exec);
  const workspacePath = folders[0].uri.fsPath;

  let output: string;
  try {
    const { stdout, stderr } = await exec("webpack --config webpack.dev.js", { cwd: workspacePath });
    output = `${stdout ?? ""}\n${stderr ?? ""}`;
  } catch (error: any) {
    const failureOutput = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
    context.channel.appendLine(stripAnsi(failureOutput));
    context.channel.appendLine(`Build failed: ${error?.error?.message ?? error?.message ?? "unknown error"}`);
    context.channel.show();
    vscode.window.showErrorMessage("Error building webresources, see output for details.");
    return false;
  }

  context.channel.appendLine(stripAnsi(output));
  if (buildOutputHasErrors(output)) {
    context.channel.show();
    vscode.window.showErrorMessage("Error building webresources, see output for details.");
    return false;
  }

  vscode.window.showInformationMessage("Building Complete");
  return true;
}
