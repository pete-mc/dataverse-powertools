import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { getTraceLogSetting, setTraceLogSetting, TraceLogLevel } from "./dataverse/traceLogSetting";
import { canCallDataverseApi } from "./dataverse/connectionReady";
import { getTraceLogCache, refreshPanelData } from "../panel/panelDataCache";

// General command (#137): manage the org-wide plug-in trace-log level from the panel's org-header
// tag. Needs a live connection (not a plugin component), so it's registered once with the other
// general connection commands — never in the project-type registry. Works under both auth types.

interface TraceLogPick extends vscode.QuickPickItem {
  level: TraceLogLevel;
}

export async function setTraceLogLevel(context: DataversePowerToolsContext): Promise<void> {
  const dataverse = context.dataverse;
  if (!dataverse || !canCallDataverseApi({ organizationUrl: dataverse.organizationUrl, isValid: dataverse.isValid })) {
    vscode.window.showErrorMessage("Connect to Dataverse first to change the plug-in trace log level.");
    return;
  }

  // Prefer the cached level (already read on connect); fall back to a live read.
  const current = getTraceLogCache() ?? (await getTraceLogSetting(context));

  const base: TraceLogPick[] = [
    { level: 0, label: "Off", description: "No plug-in trace logging" },
    { level: 1, label: "Exception only", description: "Log traces only when a plug-in throws" },
    { level: 2, label: "All", description: "Log every plug-in trace (perf/storage cost)" },
  ];
  // Mark the current level with a check + pre-select it.
  const items: TraceLogPick[] = base.map((item) => (item.level === current ? { ...item, label: `$(check) ${item.label}`, picked: true } : item));

  const pick = await vscode.window.showQuickPick(items, { placeHolder: "Set the plug-in trace log level", ignoreFocusOut: true });
  if (!pick || pick.level === current) {
    return;
  }

  // Switching to All has a perf/storage cost — confirm before turning the firehose on.
  if (pick.level === 2) {
    const confirm = await vscode.window.showWarningMessage(
      "Set plug-in trace logging to All? Every plug-in execution writes a trace log — this has a performance and storage cost. Turn it off again when you're done.",
      { modal: true },
      "Set to All",
    );
    if (confirm !== "Set to All") {
      return;
    }
  }

  const ok = await setTraceLogSetting(context, pick.level);
  if (!ok) {
    vscode.window.showErrorMessage("Could not update the plug-in trace log level — see the output.");
    return;
  }
  context.channel.appendLine(`[Trace] Plug-in trace log level set to ${pick.level} (${pick.label.replace(/^\$\(check\)\s*/, "")}).`);
  // Re-read + re-render so the org-header tag re-colours immediately.
  await refreshPanelData(context);
}
