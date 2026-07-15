// Command: send a sample Dataverse webhook (RemoteExecutionContext) to the local
// Functions host (#145 #7) — the inner loop without a live trigger. Run the host
// first with "Run locally (func start)". Builds a docs-accurate payload
// (sampleContext.ts) and POSTs it to http://localhost:<port>/api/<function>.

import fetch from "node-fetch";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { buildSampleRemoteExecutionContext } from "./sampleContext";

export async function sendTestContext(context: DataversePowerToolsContext): Promise<void> {
  const functionName = await vscode.window.showInputBox({
    prompt: "Function name (the route after /api/ on the local host).",
    placeHolder: "OnAccountCreate",
    validateInput: (v) => (v.trim() ? undefined : "Enter the function name."),
  });
  if (!functionName) {
    return;
  }

  const url = await vscode.window.showInputBox({
    prompt: "Local function URL",
    value: `http://localhost:7071/api/${functionName.trim()}`,
  });
  if (!url) {
    return;
  }

  const messageName = (await vscode.window.showInputBox({ prompt: "Message name", value: "Create" }))?.trim();
  if (messageName === undefined) {
    return;
  }
  const primaryEntityName = (await vscode.window.showInputBox({ prompt: "Primary entity logical name", value: "account" }))?.trim();
  if (primaryEntityName === undefined) {
    return;
  }

  const payload = buildSampleRemoteExecutionContext({ messageName: messageName || "Create", primaryEntityName: primaryEntityName || "account", timestampMs: 0 });

  context.channel.show(true);
  context.channel.appendLine(`\nPOST ${url}  (sample ${messageName} of ${primaryEntityName})`);
  try {
    const response = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Sending test context…" }, async () => {
      /* eslint-disable @typescript-eslint/naming-convention */
      return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } as never);
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    const body = await response.text();
    context.channel.appendLine(`→ ${response.status} ${response.statusText}${body ? `\n${body}` : ""}`);
    if (response.ok) {
      vscode.window.showInformationMessage(`Test context sent — ${response.status}.`);
    } else {
      vscode.window.showWarningMessage(`Function returned ${response.status}. See the Dataverse PowerTools output.`);
    }
  } catch (error) {
    context.channel.appendLine(`Could not reach ${url}: ${(error as Error).message}`);
    vscode.window.showErrorMessage("Could not reach the local function. Start it first with 'Run locally (func start)'.");
  }
}
