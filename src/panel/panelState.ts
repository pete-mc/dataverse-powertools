import * as vscode from "vscode";
import fs = require("fs");
import path = require("path");
import DataversePowerToolsContext from "../context";
import { PanelState, ActivityItem, ProjectCardState } from "./menuModel";
import { parseConnectionString, getOrganizationUrl } from "../general/connectionString";
import { parseAuthType, DataverseAuthType } from "../general/dataverse/authTypes";
import { getSystemRequirementsStatus } from "../general/systemRequirements";
import { getRecentOperations } from "./operationTracker";
import { getScannedRegistrations } from "./registrationsScanner";
import { isDebugSessionActive } from "../webresources/debug/debugWebresources";
import { ComponentSettings } from "../components/discovery";

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
    componentRoot: op.componentRoot,
  }));
}

function projectCard(settings: ComponentSettings, root: string, relativeRoot: string, isRoot: boolean): ProjectCardState {
  return {
    type: settings.type ?? "",
    name: (settings.solutionName as string) || (settings.pluginProjectName as string) || relativeRoot || "",
    relativeRoot,
    root,
    isRoot,
    detail: settings.pluginProjectName ? `${settings.pluginProjectName}.csproj` : undefined,
    templateVersion: settings.templateversion,
    hasPluginUnitTesting: !!settings.pluginUnitTestingEnabled,
    hasSpkl: fs.existsSync(path.join(root, "spkl.json")),
    webresourceOutput: settings.webresourceOutput as "bundle" | "perFile" | undefined,
  };
}

/** Snapshot the extension state the actions panel renders. Read-only and cheap:
 * called on every panel refresh, so no network or process spawns here. */
export function computePanelState(context: DataversePowerToolsContext): PanelState {
  const settings = context.projectSettings ?? {};
  const loaded = !!settings.connectionString;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // One card per discovered component (#47). The ROOT component renders from
  // context.projectSettings (the processed settings), matching command
  // behaviour; a legacy workspace with no discovery still gets its card.
  const projects: ProjectCardState[] = [];
  for (const component of context.components ?? []) {
    if (!component.settings.type) {
      continue;
    }
    projects.push(
      component.isRoot && workspaceRoot
        ? projectCard(settings as ComponentSettings, workspaceRoot, "", true)
        : projectCard(component.settings, component.root, component.relativeRoot, component.isRoot),
    );
  }
  if (projects.length === 0 && settings.type && workspaceRoot) {
    projects.push(projectCard(settings as ComponentSettings, workspaceRoot, "", true));
  }

  return {
    detecting: !context.folderStateReady,
    loaded,
    projects,
    organizationUrl: loaded ? getOrganizationUrl(context.connectionString) : undefined,
    authType: loaded && parseAuthType(parseConnectionString(context.connectionString).authType) === DataverseAuthType.oauth ? "oauth" : "clientsecret",
    environmentLabel: settings.environmentLabel,
    connected: !!context.dataverse?.isValid,
    debugSessionActive: isDebugSessionActive(),
    // Rows come from the per-component decoration scan of webresources_src (the
    // source of truth), not settings. index → openScannedRegistration go-to-file.
    formRegistrations: getScannedRegistrations().map((registration, index) => ({
      label: registration.functionName,
      detail: registration.event,
      index,
    })),
    activity: activityItems(),
    requirements: getSystemRequirementsStatus(),
  };
}
