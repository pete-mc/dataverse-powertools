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
import { getTraceLogCache, getActiveProfilesCache } from "./panelDataCache";
import { isDebugSessionActive } from "../webresources/debug/debugWebresources";
import { ComponentSettings } from "../components/discovery";
import { clock, buildProjectCard } from "./panelCards";

function activityItems(): ActivityItem[] {
  return getRecentOperations().map((op) => ({
    label: op.label,
    status: op.status,
    time: op.status === "running" ? "" : clock(op.finishedAt),
    detail: op.detail,
    componentRoot: op.componentRoot,
  }));
}

/** Profiles downloaded into <root>/profiles (#63 phase 2a). */
function countDownloadedProfiles(root: string): number {
  try {
    return fs.readdirSync(path.join(root, "profiles")).filter((file) => file.includes(".profile")).length;
  } catch {
    return 0;
  }
}

/** Gather the fs/OS facts for a card, then delegate the field mapping to the
 * pure builder in panelCards.ts. */
function projectCard(settings: ComponentSettings, root: string, relativeRoot: string, isRoot: boolean): ProjectCardState {
  const isPlugin = settings.type === "plugin";
  return buildProjectCard(settings, root, relativeRoot, isRoot, {
    hasSpkl: fs.existsSync(path.join(root, "spkl.json")),
    downloadedProfiles: isPlugin ? countDownloadedProfiles(root) : undefined,
    captureSupported: isPlugin ? process.platform === "win32" : undefined,
  });
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
    // Dataverse-derived values read from the cache refreshed on connect/refresh (#137/#139) —
    // never fetched here (this function is called on every render and must stay network-free).
    traceLog: getTraceLogCache(),
    activeProfiles: getActiveProfilesCache().map((profile, index) => ({
      label: profile.typeName || "Profiled step",
      detail: [profile.message, profile.primaryEntity].filter(Boolean).join(" · "),
      index,
    })),
    debugSessionActive: isDebugSessionActive(),
    // Rows come from the per-component decoration scan of webresources_src (the
    // source of truth), not settings. index → openScannedRegistration go-to-file.
    formRegistrations: getScannedRegistrations().map((registration, index) => ({
      label: registration.functionName,
      detail: registration.event,
      index,
      componentRoot: registration.componentRoot,
    })),
    activity: activityItems(),
    requirements: getSystemRequirementsStatus(),
    // Sidebar arrangement + Add-Component gating (#118): the root's own layout, and
    // whether the root is connection-only (Empty) vs a typed single-project root.
    layout: (settings.layout as PanelState["layout"]) ?? undefined,
    rootIsEmpty: loaded ? !settings.type : undefined,
    // More than one discovered component → the panel minimises cards by default (#156).
    multiComponent: (context.components?.length ?? 0) > 1,
  };
}
