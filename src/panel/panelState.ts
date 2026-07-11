import * as vscode from "vscode";
import fs = require("fs");
import path = require("path");
import DataversePowerToolsContext from "../context";
import { PanelState, ActivityItem } from "./menuModel";
import { parseConnectionString, getOrganizationUrl } from "../general/connectionString";
import { parseAuthType, DataverseAuthType } from "../general/dataverse/authTypes";
import { getSystemRequirementsStatus } from "../general/systemRequirements";
import { getRecentOperations } from "./operationTracker";
import { getScannedRegistrations } from "./registrationsScanner";
import { isDebugSessionActive } from "../webresources/debug/debugWebresources";

function clock(timestamp: number | undefined): string {
  if (timestamp === undefined) {
    return "";
  }
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function activityItems(): ActivityItem[] {
  return getRecentOperations().map((op) => ({
    label: op.label,
    status: op.status,
    time: op.status === "running" ? "" : clock(op.finishedAt),
    detail: op.detail,
  }));
}

/** Snapshot the extension state the actions panel renders. Read-only and cheap:
 * called on every panel refresh, so no network or process spawns here. */
export function computePanelState(context: DataversePowerToolsContext): PanelState {
  const settings = context.projectSettings ?? {};
  const loaded = !!settings.connectionString;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return {
    detecting: !context.folderStateReady,
    loaded,
    projectType: settings.type,
    projectName: settings.solutionName || settings.pluginProjectName,
    projectDetail: settings.pluginProjectName ? `${settings.pluginProjectName}.csproj` : undefined,
    templateVersion: settings.templateversion,
    hasPluginUnitTesting: !!settings.pluginUnitTestingEnabled,
    hasSpkl: workspaceRoot ? fs.existsSync(path.join(workspaceRoot, "spkl.json")) : false,
    organizationUrl: loaded ? getOrganizationUrl(context.connectionString) : undefined,
    authType: loaded && parseAuthType(parseConnectionString(context.connectionString).authType) === DataverseAuthType.oauth ? "oauth" : "clientsecret",
    environmentLabel: settings.environmentLabel,
    connected: !!context.dataverse?.isValid,
    debugSessionActive: isDebugSessionActive(),
    // Rows come from the decoration scan of webresources_src (the source of
    // truth), not settings. index → openScannedRegistration go-to-file.
    formRegistrations: getScannedRegistrations().map((registration, index) => ({
      label: registration.functionName,
      detail: registration.event,
      index,
    })),
    activity: activityItems(),
    requirements: getSystemRequirementsStatus(),
  };
}
