import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";

// Run an npm script in the active PCF component root. `exec` spawns through a shell
// (cmd.exe on Windows), so the `npm` .cmd shim resolves — the same reason the
// webresource build goes through `exec` rather than spawning `npm` directly (the
// EINVAL trap). The project's LOCAL bin is used because pcf-scripts lives in the
// scaffolded control's devDependencies, never as a global.
export async function runPcfNpmScript(
  context: DataversePowerToolsContext,
  script: string,
  progressTitle: string,
  successMessage: string,
  failureMessage: string,
): Promise<boolean> {
  const componentRoot = activeComponentRoot(context);
  if (!componentRoot) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return false;
  }

  const util = require("util");
  const exec = util.promisify(require("child_process").exec);

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: progressTitle,
    },
    async () => {
      try {
        const { stdout, stderr } = await exec(`npm run ${script}`, { cwd: componentRoot });
        if (stdout) {
          context.channel.appendLine(String(stdout));
        }
        if (stderr) {
          context.channel.appendLine(String(stderr));
        }
        context.channel.appendLine(successMessage);
        vscode.window.showInformationMessage(successMessage);
        return true;
      } catch (error: any) {
        if (error?.stdout) {
          context.channel.appendLine(String(error.stdout));
        }
        if (error?.stderr) {
          context.channel.appendLine(String(error.stderr));
        }
        const message = error?.error?.message || error?.message || "Unknown error";
        context.channel.appendLine(`${failureMessage}: ${message}`);
        context.channel.show();
        vscode.window.showErrorMessage(failureMessage);
        return false;
      }
    },
  );
}
