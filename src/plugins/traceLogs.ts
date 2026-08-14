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
  // Open it READ-ONLY through a virtual document, not as an untitled one. An untitled document counts
  // as unsaved, so closing a trace log you have only read prompted "do you want to save?" every time —
  // for something the extension generated and nobody edits.
  const uri = traceLogUri(pick.target);
  traceLogContents.set(uri.toString(), formatTraceLog(pick.target));
  traceLogChanged.fire(uri);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(document, "markdown");
  await vscode.window.showTextDocument(document, { preview: true });
}

/** Scheme for generated trace-log documents. Read-only: VS Code never offers to save these. */
export const TRACE_LOG_SCHEME = "dvpt-tracelog";

const traceLogContents = new Map<string, string>();
const traceLogChanged = new vscode.EventEmitter<vscode.Uri>();

/** A stable, readable URI per log — the title bar shows the type and time rather than "Untitled-1". */
function traceLogUri(log: PluginTraceLogRecord): vscode.Uri {
  const type = (log.typename ?? "plugin").split(",")[0].split(".").pop() ?? "plugin";
  const when = (log.createdon ?? "").replace(/[:.]/g, "-");
  return vscode.Uri.parse(`${TRACE_LOG_SCHEME}:${type} ${when}.md`);
}

/**
 * Serve generated trace-log documents. Registered ONCE at activation (never in a per-component
 * `initialise*` — a second component would throw on the duplicate scheme).
 */
export function registerTraceLogDocumentProvider(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(TRACE_LOG_SCHEME, {
      onDidChange: traceLogChanged.event,
      provideTextDocumentContent: (uri) => traceLogContents.get(uri.toString()) ?? "",
    }),
  );
}
