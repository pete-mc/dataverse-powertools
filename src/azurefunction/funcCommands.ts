// Azure Functions Core Tools (`func`) commands — #145 #6/#7. Run in a VS Code
// integrated terminal because both are long-lived / interactive: `func start`
// hosts the function until stopped, and `func azure functionapp publish` prompts
// for Azure sign-in. The pure arg building is unit-tested in funcArgs.ts.
//
// These shell out to `func` (Azure Functions Core Tools) and, for publish, expect
// the user to be signed in to Azure — verify against your subscription.

import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";
import { funcAzurePublishArgs, funcStartArgs, toCommandLine } from "./funcArgs";

function runInTerminal(name: string, cwd: string, commandLine: string): void {
  const terminal = vscode.window.createTerminal({ name, cwd });
  terminal.show(true);
  terminal.sendText(commandLine);
}

/** Publish the built function to Azure with `func azure functionapp publish <app>`. */
export async function publishAzureFunctionToAzure(context: DataversePowerToolsContext): Promise<void> {
  const root = activeComponentRoot(context);
  if (!root) {
    vscode.window.showErrorMessage("Open or select an Azure Functions component first.");
    return;
  }

  const appName = await vscode.window.showInputBox({
    prompt: "Azure Function App name to publish to (must already exist, and you must be signed in to Azure).",
    placeHolder: "my-function-app",
    validateInput: (v) => (v.trim() ? undefined : "Enter the Function App name."),
  });
  if (!appName) {
    return;
  }

  context.channel.appendLine(`Publishing to Azure Function App '${appName.trim()}' via func — see the terminal.`);
  runInTerminal(`func publish · ${appName.trim()}`, root, toCommandLine("func", funcAzurePublishArgs(appName.trim())));
}

/** Run the Functions host locally with `func start` (the inner loop). */
export function startAzureFunctionHost(context: DataversePowerToolsContext): void {
  const root = activeComponentRoot(context);
  if (!root) {
    vscode.window.showErrorMessage("Open or select an Azure Functions component first.");
    return;
  }
  context.channel.appendLine("Starting the local Functions host (func start) — see the terminal. Stop it with Ctrl+C.");
  runInTerminal("func start", root, toCommandLine("func", funcStartArgs()));
}
