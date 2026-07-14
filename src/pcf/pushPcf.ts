import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { runPac } from "../general/modelbuilder/commandRunner";
import { ensurePacAuthForCurrentConnection, isPacAuthError, reestablishPacAuthForCurrentConnection } from "../general/pacAuth";
import { activeComponentRoot } from "../components/componentDiscovery";
import { pcfPushArgs } from "./pcfArgs";

// `pac pcf push` — the fast, one-click dev inner loop that imports the control into
// the connected environment (a temporary PowerAppsTools solution). Mirrors how
// generateEarlyBoundV3 authenticates the extension's pac profile from the current
// connection first, then runs pac.
//
// Auth: gate on the live connection via ensurePacAuthForCurrentConnection — NEVER on
// tenantId (interactive/OAuth connections carry no tenantId; see CLAUDE.md #90/#91).
/** Run pac; if it fails with a pac AUTH error, re-establish the extension's pac
 * profile and retry ONCE. runPac rejects with { error, stdout, stderr }; non-auth
 * failures re-throw for the caller's existing error handling. */
async function runPacWithAuthRetry(context: DataversePowerToolsContext, args: string[], workspacePath: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await runPac(args, workspacePath);
  } catch (error: any) {
    const combined = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.error?.message ?? error?.message ?? ""}`;
    if (!isPacAuthError(combined)) {
      throw error;
    }
    context.channel.appendLine("[pac] Authentication error — re-establishing the pac profile and retrying once.");
    if (!(await reestablishPacAuthForCurrentConnection(context, workspacePath))) {
      throw error;
    }
    return runPac(args, workspacePath);
  }
}

export async function pushPcf(context: DataversePowerToolsContext): Promise<void> {
  const workspacePath = activeComponentRoot(context);
  if (!workspacePath) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  const prefix = context.projectSettings.prefix;
  if (!prefix) {
    context.channel.appendLine("Cannot push PCF control: no publisher prefix is configured for this project.");
    context.channel.show();
    vscode.window.showErrorMessage("No publisher prefix configured; cannot push the PCF control. Set a prefix on the connection and retry.");
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Pushing PCF control with pac pcf push...",
    },
    async () => {
      try {
        // pac pcf push imports into the connection's environment — authenticate the
        // extension's pac profile from the connection string first (works under both
        // service-principal and interactive auth).
        if (!(await ensurePacAuthForCurrentConnection(context, workspacePath))) {
          return;
        }
        const { stdout, stderr } = await runPacWithAuthRetry(context, pcfPushArgs(prefix), workspacePath);
        if (stdout) {
          context.channel.appendLine(stdout);
        }
        if (stderr) {
          context.channel.appendLine(stderr);
        }
        context.channel.appendLine("PCF push complete.");
        vscode.window.showInformationMessage("PCF control pushed to the environment.");
      } catch (error: any) {
        if (error?.stdout) {
          context.channel.appendLine(error.stdout);
        }
        if (error?.stderr) {
          context.channel.appendLine(error.stderr);
        }
        context.channel.appendLine(`Error running pac pcf push: ${error?.error?.message || error?.message || "Unknown error"}`);
        context.channel.show();
        vscode.window.showErrorMessage("Error pushing PCF control. See output for details.");
      }
    },
  );
}
