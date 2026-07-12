import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { stripAnsi } from "./buildOutput";
import { activeComponentRoot } from "../components/componentDiscovery";

// Run the project's LOCAL jest via `npx`, like the webpack build — a bare `jest`
// only resolves a global install that the extension never creates. Exported so a
// unit test pins the `npx` prefix.
export const WEBRESOURCE_TEST_COMMAND = "npx jest --ci";

/** Run the component's Jest tests from the actions panel; pass/fail comes from
 * jest's exit code, full output goes to the channel. */
export async function runWebresourceTests(context: DataversePowerToolsContext): Promise<boolean> {
  const componentRoot = activeComponentRoot(context);
  if (!componentRoot) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return false;
  }

  const util = require("util");
  const exec = util.promisify(require("child_process").exec);

  try {
    const { stdout, stderr } = await exec(WEBRESOURCE_TEST_COMMAND, { cwd: componentRoot });
    context.channel.appendLine(stripAnsi(`${stdout ?? ""}\n${stderr ?? ""}`));
  } catch (error: any) {
    context.channel.appendLine(stripAnsi(`${error?.stdout ?? ""}\n${error?.stderr ?? ""}`));
    context.channel.show();
    vscode.window.showErrorMessage("Web resource tests failed, see output for details.");
    return false;
  }

  context.channel.appendLine("Tests Complete");
  vscode.window.showInformationMessage("All web resource tests passed.");
  return true;
}
