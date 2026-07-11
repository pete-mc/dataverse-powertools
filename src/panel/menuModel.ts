// Pure view-model for the actions panel (#100 v2). No `vscode` import: the
// webview is a dumb renderer of the card list this module computes, so the
// entire panel logic is unit-testable and the rendering surface is swappable.
//
// v2 design: objects with state instead of a verb list. The environment, the
// project, form registrations, a live debug session and recent operations are
// each a card; actions hang off the object they belong to; rare actions live
// in a per-card ⋯ overflow; requirements collapse to a footer line once green.
import { MenuAction, getProjectTypeDescriptor } from "../projectTypes/registry";

export interface RequirementRow {
  id: "dotnet" | "node" | "pac";
  label: string;
  /** undefined while the scan is still running. */
  ok?: boolean;
  downloadUrl: string;
}

export interface ActivityItem {
  label: string;
  status: "running" | "success" | "error";
  /** Pre-formatted clock time (e.g. "14:32"); empty while running. */
  time: string;
  detail?: string;
}

export interface StatusLine {
  icon: "running" | "ok" | "error";
  text: string;
}

export interface RegistrationRow {
  label: string;
  detail: string;
  /** Index into the scanner cache; clicking the row opens the file there. */
  index?: number;
}

/** Registrations shown before collapsing into a "+N more" note (big repos can have hundreds). */
export const MAX_REGISTRATION_ROWS = 8;

export type Card =
  | { kind: "notice"; id: string; text: string; spinner?: boolean }
  | { kind: "getStarted"; id: "getStarted"; text: string; actions: MenuAction[] }
  | { kind: "requirements"; id: "requirements"; scanning: boolean; rows: RequirementRow[]; recheck?: MenuAction }
  | {
      kind: "environment";
      id: "environment";
      name: string;
      url: string;
      authLabel: string;
      /** Optional user-set environment tag (e.g. DEV / TEST / PROD). */
      label?: string;
      connected: boolean;
      switchAction: MenuAction;
      overflow: MenuAction[];
    }
  | {
      kind: "project";
      id: string;
      name: string;
      typeLabel: string;
      detail?: string;
      primary: MenuAction;
      secondary: MenuAction[];
      overflow: MenuAction[];
      status?: StatusLine;
    }
  | { kind: "registrations"; id: "registrations"; rows: RegistrationRow[]; add: MenuAction; note?: string }
  | { kind: "session"; id: "session"; text: string; detail?: string; stop: MenuAction }
  | { kind: "activity"; id: "activity"; items: ActivityItem[] };

export interface MenuModel {
  cards: Card[];
  footer: {
    /** All requirements green — render the collapsed "✓ requirements" line. */
    requirementsOk: boolean;
    log: MenuAction;
  };
}

export interface PanelState {
  /** Still reading workspace settings on activation. */
  detecting: boolean;
  /** A connection string exists (mirrors the showLoaded context key). */
  loaded: boolean;
  projectType?: string;
  /** Display name for the project card (solution or plugin project name). */
  projectName?: string;
  /** Secondary line on the project card (e.g. the csproj). */
  projectDetail?: string;
  templateVersion?: number;
  hasPluginUnitTesting?: boolean;
  hasSpkl?: boolean;
  organizationUrl?: string;
  /** "oauth" for interactive connections, anything else is service-principal. */
  authType?: string;
  /** User-set environment tag (DEV/TEST/PROD) from dataverse-powertools.json. */
  environmentLabel?: string;
  /** Live Dataverse connection established (token acquired). */
  connected: boolean;
  /** A web-resource debug session (webpack watch + browser) is running. */
  debugSessionActive: boolean;
  /** Scanned RegisterEvent decorations, pre-formatted for display. */
  formRegistrations: RegistrationRow[];
  /** Recent tracked operations, newest first, times pre-formatted. */
  activity: ActivityItem[];
  requirements: {
    scanning: boolean;
    scanned: boolean;
    dotnet: boolean;
    node: boolean;
    pac: boolean;
  };
}

/** Full walkthrough reference: <publisher>.<extension>#<walkthrough id in package.json>. */
export const WALKTHROUGH_ID = "dataversepowertools.dataverse-powertools#gettingStarted";

const DOWNLOAD_URLS = {
  dotnet: "https://dotnet.microsoft.com/download",
  node: "https://nodejs.org/en/download",
  pac: "https://aka.ms/PowerPlatformCLI",
} as const;

/** URLs the webview is allowed to ask the host to open. */
export const ALLOWED_EXTERNAL_URLS: readonly string[] = Object.values(DOWNLOAD_URLS);

/** Short environment name from the org URL: https://contoso.crm.dynamics.com -> contoso. */
export function environmentName(organizationUrl: string | undefined): string {
  if (!organizationUrl) {
    return "environment";
  }
  const host = organizationUrl.replace(/^[a-z]+:\/\//i, "");
  const name = host.split(/[/.]/)[0];
  return name || "environment";
}

function requirementRows(state: PanelState): RequirementRow[] {
  const pending = state.requirements.scanning || !state.requirements.scanned;
  return [
    { id: "dotnet", label: ".NET SDK", ok: pending ? undefined : state.requirements.dotnet, downloadUrl: DOWNLOAD_URLS.dotnet },
    { id: "node", label: "Node.js", ok: pending ? undefined : state.requirements.node, downloadUrl: DOWNLOAD_URLS.node },
    { id: "pac", label: "Power Platform CLI (pac)", ok: pending ? undefined : state.requirements.pac, downloadUrl: DOWNLOAD_URLS.pac },
  ];
}

function allRequirementsOk(state: PanelState): boolean {
  return state.requirements.scanned && !state.requirements.scanning && state.requirements.dotnet && state.requirements.node && state.requirements.pac;
}

function requirementsCard(state: PanelState): Card {
  return {
    kind: "requirements",
    id: "requirements",
    scanning: state.requirements.scanning,
    rows: requirementRows(state),
    recheck: state.requirements.scanned ? { command: "dataverse-powertools.recheckRequirements", label: "Recheck Requirements" } : undefined,
  };
}

function environmentCard(state: PanelState): Card {
  return {
    kind: "environment",
    id: "environment",
    name: environmentName(state.organizationUrl),
    url: (state.organizationUrl ?? "").replace(/^[a-z]+:\/\//i, ""),
    authLabel: state.authType === "oauth" ? "OAuth" : "Service Principal",
    label: state.environmentLabel,
    connected: state.connected,
    switchAction: { command: "dataverse-powertools.switchEnvironment", label: "Switch" },
    // Restore Dependencies lives on the PROJECT card — it restores the
    // project's packages, not the connection (manual-testing feedback).
    overflow: [
      { command: "dataverse-powertools.refreshConnection", label: "Refresh connection" },
      { command: "dataverse-powertools.updateConnectionString", label: "Update authentication" },
    ],
  };
}

function statusFromActivity(activity: ActivityItem[]): StatusLine | undefined {
  const latest = activity[0];
  if (!latest) {
    return undefined;
  }
  if (latest.status === "running") {
    return { icon: "running", text: `${latest.label}…` };
  }
  if (latest.status === "error") {
    return { icon: "error", text: `${latest.label} failed ${latest.time}`.trim() };
  }
  return { icon: "ok", text: `${latest.label} ${latest.time}`.trim() };
}

/** Footer shows the collapsed "✓ requirements" line only when no requirements
 * card is on screen — never both at once. */
function footerFor(state: PanelState, cards: Card[]): MenuModel["footer"] {
  const cardShown = cards.some((c) => c.kind === "requirements");
  return { requirementsOk: allRequirementsOk(state) && !cardShown, log: { command: "dataverse-powertools.showLog", label: "Show Log" } };
}

export function buildMenuModel(state: PanelState): MenuModel {
  if (state.detecting) {
    const cards: Card[] = [{ kind: "notice", id: "detecting", text: "Getting things ready — detecting your Dataverse project…", spinner: true }];
    return { cards, footer: footerFor(state, cards) };
  }

  if (!state.loaded) {
    const cards: Card[] = [
      {
        kind: "getStarted",
        id: "getStarted",
        text: "No Dataverse PowerTools project detected in this workspace.",
        actions: [
          { command: "dataverse-powertools.initialiseProject", label: "Initialise Project" },
          { command: "workbench.action.openWalkthrough", label: "Open Walkthrough", args: [WALKTHROUGH_ID] },
        ],
      },
      requirementsCard(state),
    ];
    return { cards, footer: footerFor(state, cards) };
  }

  const cards: Card[] = [environmentCard(state)];
  const descriptor = getProjectTypeDescriptor(state.projectType);

  if (descriptor) {
    const menu = descriptor.menu(state);
    const environment = environmentName(state.organizationUrl);
    cards.push({
      kind: "project",
      id: `project:${descriptor.id}`,
      name: state.projectName || descriptor.displayName,
      typeLabel: descriptor.displayName.toUpperCase(),
      detail: state.projectDetail,
      primary: { ...menu.primary, label: menu.primary.label.replace("{environment}", environment) },
      secondary: menu.secondary,
      overflow: [...menu.overflow, { command: "dataverse-powertools.restoreDependencies", label: "Restore dependencies" }],
      status: statusFromActivity(state.activity),
    });
  } else {
    cards.push({
      kind: "notice",
      id: "unsupported",
      text: state.projectType
        ? `Project type "${state.projectType}" is not supported by this version of the extension.`
        : "This workspace has a connection but no project type. Re-run Initialise Project to scaffold one.",
    });
  }

  if (descriptor?.id === "webresources") {
    const overflowCount = Math.max(0, state.formRegistrations.length - MAX_REGISTRATION_ROWS);
    cards.push({
      kind: "registrations",
      id: "registrations",
      rows: state.formRegistrations.slice(0, MAX_REGISTRATION_ROWS),
      add: { command: "dataverse-powertools.addFormDecoration", label: "Add" },
      note: overflowCount > 0 ? `+${overflowCount} more · Registered on every deploy` : "Registered on every deploy",
    });
    if (state.debugSessionActive) {
      cards.push({
        kind: "session",
        id: "session",
        text: "Local debug session running",
        detail: "webpack watch + browser",
        stop: { command: "dataverse-powertools.stopDebugWebresources", label: "Stop" },
      });
    }
  }

  if (state.activity.length > 0) {
    cards.push({ kind: "activity", id: "activity", items: state.activity });
  }

  if (!allRequirementsOk(state)) {
    cards.push(requirementsCard(state));
  }

  return { cards, footer: footerFor(state, cards) };
}
