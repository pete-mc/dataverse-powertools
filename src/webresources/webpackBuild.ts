import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { stripAnsi, buildOutputHasErrors } from "./buildOutput";
import { activeComponentRoot } from "../components/componentDiscovery";

// Build with `npx` so the project's LOCAL webpack devDependency is used. A bare `webpack` resolves
// only against the system PATH and fails with "'webpack' is not recognized" wherever there is no
// global install — which the extension never creates. Exported so a unit test pins the `npx` prefix
// (the e2e VM has a global webpack that would otherwise mask a regression back to bare `webpack`).
export const WEBRESOURCE_BUILD_COMMAND = "npx webpack --config webpack.dev.js";

/**
 * Runs the webresource webpack build and resolves to `true` on success.
 *
 * Replaces the previous pattern that wired up stdout/stderr `data` listeners and
 * invoked deploy from a detached `close` handler: build success is now decided by
 * the process exit code (a rejected promise) plus an "ERROR in" scan of the output,
 * and the caller can safely `await` this before deploying.
 */
export async function runWebresourceBuild(context: DataversePowerToolsContext): Promise<boolean> {
  const componentRoot = activeComponentRoot(context);
  if (!componentRoot) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return false;
  }

  const util = require("util");
  const exec = util.promisify(require("child_process").exec);
  const workspacePath = componentRoot;

  let output: string;
  try {
    const { stdout, stderr } = await exec(WEBRESOURCE_BUILD_COMMAND, { cwd: workspacePath });
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

  context.channel.appendLine("Building Complete");
  vscode.window.showInformationMessage("Building Complete");
  return true;
}
