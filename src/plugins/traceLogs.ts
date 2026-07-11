import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { getPluginTraceLogs, PluginTraceLogRecord } from "../general/dataverse/getPluginTraceLogs";

// View Plugin Trace Logs (#63 phase 1): pull the latest plugintracelog records
// and open the chosen one as a formatted markdown document — types, message,
// stage timings, exception and the trace block, without leaving VS Code.
// (Set the org's plug-in trace setting to All/Exception for logs to appear.)

// eslint-disable-next-line @typescript-eslint/naming-convention -- keys are Dataverse option-set values
const OPERATION_TYPES: Record<number, string> = { 1: "Plug-in", 2: "Workflow Activity" };
// eslint-disable-next-line @typescript-eslint/naming-convention -- keys are Dataverse option-set values
const MODES: Record<number, string> = { 0: "Synchronous", 1: "Asynchronous" };

/** Pure formatter — unit-testable. */
export function formatTraceLog(log: PluginTraceLogRecord): string {
  const lines = [
    `# Plugin trace — ${log.typename ?? "(unknown type)"}`,
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| Created | ${log.createdon ?? ""} |`,
    `| Message | ${log.messagename ?? ""} |`,
    `| Entity | ${log.primaryentity ?? ""} |`,
    `| Operation | ${OPERATION_TYPES[log.operationtype ?? -1] ?? log.operationtype ?? ""} |`,
    `| Mode | ${MODES[log.mode ?? -1] ?? log.mode ?? ""} |`,
    `| Depth | ${log.depth ?? ""} |`,
    `| Duration | ${log.performanceexecutionduration ?? "?"} ms |`,
    `| Correlation | ${log.correlationid ?? ""} |`,
    "",
  ];
  if (log.exceptiondetails) {
    lines.push("## Exception", "", "```", log.exceptiondetails, "```", "");
  }
  lines.push("## Trace", "", "```", log.messageblock || "(no trace messages — use ITracingService.Trace(...) in the plug-in)", "```", "");
  return lines.join("\n");
}

export async function viewPluginTraceLogs(context: DataversePowerToolsContext): Promise<void> {
  const logs = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Fetching plugin trace logs..." }, () => getPluginTraceLogs(context));
  if (!logs) {
    vscode.window.showErrorMessage("Could not fetch plugin trace logs. See the Dataverse PowerTools output.");
    return;
  }
  if (logs.length === 0) {
    vscode.window.showInformationMessage(
      "No plugin trace logs found. Enable plug-in trace logging (Settings → Administration → System Settings → Customization) and trigger your plug-in.",
    );
    return;
  }
  const pick = await vscode.window.showQuickPick(
    logs.map((log) => ({
      label: `${log.exceptiondetails ? "$(error)" : "$(pass)"} ${log.typename ?? "(unknown)"}`,
      description: `${log.messagename ?? ""} · ${log.primaryentity ?? ""} · ${log.performanceexecutionduration ?? "?"}ms`,
      detail: log.createdon,
      target: log,
    })),
    { placeHolder: "Which trace log? (newest first)", matchOnDescription: true },
  );
  if (!pick) {
    return;
  }
  const document = await vscode.workspace.openTextDocument({ language: "markdown", content: formatTraceLog(pick.target) });
  await vscode.window.showTextDocument(document, { preview: true });
}
