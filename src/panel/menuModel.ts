// Pure view-model for the actions panel (#100 v2). No `vscode` import: the
// webview is a dumb renderer of the card list this module computes, so the
// entire panel logic is unit-testable and the rendering surface is swappable.
//
// v2 design: objects with state instead of a verb list. The environment, the
// project, form registrations, a live debug session and recent operations are
// each a card; actions hang off the object they belong to; rare actions live
// in a per-card ⋯ overflow; requirements collapse to a footer line once green.
import { MenuAction, ProjectMenuState, getProjectTypeDescriptor } from "../projectTypes/registry";
import { normalizeFsPath, applyLayout, Layout } from "../components/discovery";

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
  /** Root of the component the operation ran against; undefined = workspace root (#47). */
  componentRoot?: string;
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
  /** Owning web-resource component root; undefined for legacy workspace-wide scans. */
  componentRoot?: string;
}

/** The form-registrations block embedded in a web-resource project card. */
export interface RegistrationsBlock {
  rows: RegistrationRow[];
  add: MenuAction;
  note?: string;
}

/** The profiler/debugging block embedded in a plugin project card (#63). Local
 * data only (a scan of profiles/), so the panel stays network-free. Capture is
 * Windows-only (a net48 tool); download + replay-from-file work everywhere. */
export interface DebuggingBlock {
  /** Profiles downloaded into / dropped in profiles/. */
  downloadedProfiles: number;
  /** Start Profiling the next plugin run and fetch it (Windows-only). */
  capture: MenuAction;
  /** Whether the capture action can run here (win32). When false the panel gates it
   * and points at the download/file path instead. */
  captureSupported: boolean;
  /** Fetch a captured run from the org (execution picker when there are several). */
  download: MenuAction;
  /** Generate + debug a replay test from a downloaded/dropped profile (file picker). */
  replay: MenuAction;
}

/** Registrations shown before collapsing into a "+N more" note (big repos can have hundreds). */
export const MAX_REGISTRATION_ROWS = 8;

export type Card =
  | { kind: "notice"; id: string; text: string; spinner?: boolean }
  | { kind: "getStarted"; id: "getStarted"; text: string; actions: MenuAction[] }
  | { kind: "actions"; id: string; actions: MenuAction[] }
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
      /** relativeRoot — the drag id for reordering/grouping (#118); "" for the root card (not draggable). */
      dndId: string;
      primary: MenuAction;
      secondary: MenuAction[];
      overflow: MenuAction[];
      status?: StatusLine;
      /** Web-resource cards embed their own registrations, right under the buttons (#47). */
      registrations?: RegistrationsBlock;
      /** Plugin cards embed a profiler/debugging block, right under the buttons (#63). */
      debugging?: DebuggingBlock;
    }
  /** A user-defined group of project cards (#118), collapsible, a drop target. */
  | { kind: "group"; id: string; name: string; collapsed: boolean; projects: Card[] }
  | { kind: "session"; id: "session"; text: string; detail?: string; stop: MenuAction }
  | { kind: "activity"; id: "activity"; items: ActivityItem[] };

export interface MenuModel {
  cards: Card[];
  footer: {
    /** All requirements green — render the collapsed "✓ requirements" line. */
    requirementsOk: boolean;
    log: MenuAction;
    /** Help & feedback links (Docs, Report an issue) — #120. */
    help: readonly { label: string; url: string }[];
  };
}

/** One workspace component as the panel sees it (#47). */
export interface ProjectCardState extends ProjectMenuState {
  type: string;
  name: string;
  /** Component folder relative to the workspace root; "" for the root component. */
  relativeRoot: string;
  /** Absolute component root — appended to every card action's args so the
   * command handler resolves THIS component. */
  root: string;
  isRoot: boolean;
  /** Secondary line (e.g. the csproj); the relativeRoot is shown when set. */
  detail?: string;
  /** Plugin cards only: profiles downloaded into profiles/ (local scan). */
  downloadedProfiles?: number;
  /** Plugin cards only: whether headless capture (Start Profiling) can run here
   * (Windows). Set from the host platform in panelState. */
  captureSupported?: boolean;
}

export interface PanelState {
  /** Still reading workspace settings on activation. */
  detecting: boolean;
  /** A connection string exists (mirrors the showLoaded context key). */
  loaded: boolean;
  /** One entry per discovered component, root first (#47). */
  projects: ProjectCardState[];
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
  /** User-arranged sidebar layout from the root settings (#118). */
  layout?: Layout;
  /** The root is connection-only (Empty) — Add Component is offered only then (#118). */
  rootIsEmpty?: boolean;
}

/** Full walkthrough reference: <publisher>.<extension>#<walkthrough id in package.json>. */
export const WALKTHROUGH_ID = "dataversepowertools.dataverse-powertools#gettingStarted";

const DOWNLOAD_URLS = {
  dotnet: "https://dotnet.microsoft.com/download",
  node: "https://nodejs.org/en/download",
  pac: "https://aka.ms/PowerPlatformCLI",
} as const;

/** Help & feedback links shown in the panel footer (#120). */
export const HELP_LINKS: readonly { label: string; url: string }[] = [
  { label: "Docs", url: "https://github.com/pete-mc/dataverse-powertools/wiki" },
  { label: "Report an issue", url: "https://github.com/pete-mc/dataverse-powertools/issues/new/choose" },
];

/** URLs the webview is allowed to ask the host to open. */
export const ALLOWED_EXTERNAL_URLS: readonly string[] = [...Object.values(DOWNLOAD_URLS), ...HELP_LINKS.map((l) => l.url)];

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
      { command: "dataverse-powertools.openEnvironment", label: "Open environment" },
      { command: "dataverse-powertools.openAdminCenter", label: "Open Admin Center" },
      { command: "dataverse-powertools.openMakerPortal", label: "Open Maker Portal" },
      { command: "dataverse-powertools.refreshConnection", label: "Refresh connection" },
      { command: "dataverse-powertools.updateConnectionString", label: "Update authentication" },
    ],
  };
}

/** The registrations that belong to one web-resource card: rows scanned from its
 * component root (a legacy workspace-wide scan has no root and matches any card). */
function registrationsFor(state: PanelState, project: ProjectCardState): RegistrationsBlock {
  const projectRoot = normalizeFsPath(project.root);
  const rows = state.formRegistrations.filter((row) => row.componentRoot === undefined || normalizeFsPath(row.componentRoot) === projectRoot);
  const overflowCount = Math.max(0, rows.length - MAX_REGISTRATION_ROWS);
  return {
    rows: rows.slice(0, MAX_REGISTRATION_ROWS),
    add: forComponent({ command: "dataverse-powertools.addFormDecoration", label: "Add" }, project),
    note: overflowCount > 0 ? `+${overflowCount} more · Registered on every deploy` : "Registered on every deploy",
  };
}

/** The profiler/debugging block for one plugin card. Status comes from a local
 * scan of profiles/, so no network is needed to render. */
function debuggingFor(project: ProjectCardState): DebuggingBlock {
  return {
    downloadedProfiles: project.downloadedProfiles ?? 0,
    capture: forComponent({ command: "dataverse-powertools.capturePluginRun", label: "Profile next run" }, project),
    captureSupported: project.captureSupported ?? false,
    download: forComponent({ command: "dataverse-powertools.downloadPluginProfiles", label: "Download a run" }, project),
    replay: forComponent({ command: "dataverse-powertools.generatePluginReplayTest", label: "Replay & debug" }, project),
  };
}

/** Latest operation attributed to a project card: operations record the
 * component root they ran against; root-component operations record none. */
function statusFromActivity(activity: ActivityItem[], project: ProjectCardState): StatusLine | undefined {
  const latest = activity.find((item) => (project.isRoot ? item.componentRoot === undefined : item.componentRoot === project.root));
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

/** Append the component root to an action's args so the handler resolves this component. */
function forComponent(action: MenuAction, project: ProjectCardState): MenuAction {
  return { ...action, args: [...(action.args ?? []), project.root] };
}

/** Footer shows the collapsed "✓ requirements" line only when no requirements
 * card is on screen — never both at once. */
function footerFor(state: PanelState, cards: Card[]): MenuModel["footer"] {
  const cardShown = cards.some((c) => c.kind === "requirements");
  return { requirementsOk: allRequirementsOk(state) && !cardShown, log: { command: "dataverse-powertools.showLog", label: "Show Log" }, help: HELP_LINKS };
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
  const environment = environmentName(state.organizationUrl);
  let hasWebresourceCard = false;

  if (state.projects.length === 0) {
    cards.push({
      kind: "notice",
      id: "noComponents",
      text: "No components yet — use ＋ Add Component below to scaffold a plugin, web-resource or solution component into a subfolder.",
    });
  }

  const buildProjectCard = (project: ProjectCardState): Card => {
    const descriptor = getProjectTypeDescriptor(project.type);
    if (!descriptor) {
      return {
        kind: "notice",
        id: `unsupported:${project.relativeRoot || "root"}`,
        text: `Project type "${project.type}"${project.relativeRoot ? ` (${project.relativeRoot})` : ""} is not supported by this version of the extension.`,
      };
    }
    const menu = descriptor.menu(project);
    const isWebresource = descriptor.id === "webresources";
    if (isWebresource) {
      hasWebresourceCard = true;
    }
    return {
      kind: "project",
      id: `project:${descriptor.id}${project.isRoot ? "" : `:${project.relativeRoot}`}`,
      name: project.name || descriptor.displayName,
      typeLabel: descriptor.displayName.toUpperCase(),
      detail: project.isRoot ? project.detail : [project.relativeRoot, project.detail].filter(Boolean).join(" · "),
      dndId: project.isRoot ? "" : project.relativeRoot,
      primary: forComponent({ ...menu.primary, label: menu.primary.label.replace("{environment}", environment) }, project),
      secondary: menu.secondary.map((action) => forComponent(action, project)),
      overflow: [...menu.overflow, { command: "dataverse-powertools.restoreDependencies", label: "Restore dependencies" }].map((action) => forComponent(action, project)),
      status: statusFromActivity(state.activity, project),
      // Each web-resource card carries its OWN registrations (multiple components each).
      registrations: isWebresource ? registrationsFor(state, project) : undefined,
      // Plugin cards carry the profiler/debugging workflow (#63).
      debugging: descriptor.id === "plugin" ? debuggingFor(project) : undefined,
    };
  };

  // Root/typed-root cards stay pinned above the arranged sub-components (#118). Sub
  // components are ordered + grouped per the saved layout.
  for (const project of state.projects.filter((p) => p.isRoot)) {
    cards.push(buildProjectCard(project));
  }
  for (const row of applyLayout(
    state.projects.filter((p) => !p.isRoot),
    state.layout,
  )) {
    if (row.kind === "component") {
      cards.push(buildProjectCard(row.component));
    } else {
      cards.push({ kind: "group", id: `group:${row.name}`, name: row.name, collapsed: row.collapsed, projects: row.components.map(buildProjectCard) });
    }
  }

  if (hasWebresourceCard && state.debugSessionActive) {
    cards.push({
      kind: "session",
      id: "session",
      text: "Local debug session running",
      detail: "webpack watch + browser",
      stop: { command: "dataverse-powertools.stopDebugWebresources", label: "Stop" },
    });
  }

  // Add Component only when the root is connection-only (Empty). A typed root offers
  // an explicit convert-to-components-workspace step first (#118).
  cards.push({
    kind: "actions",
    id: "addComponent",
    actions: [
      state.rootIsEmpty === false
        ? { command: "dataverse-powertools.convertToComponentsWorkspace", label: "Convert to a components workspace…" }
        : { command: "dataverse-powertools.addComponent", label: "＋ Add Component…" },
    ],
  });

  if (state.activity.length > 0) {
    cards.push({ kind: "activity", id: "activity", items: state.activity });
  }

  if (!allRequirementsOk(state)) {
    cards.push(requirementsCard(state));
  }

  return { cards, footer: footerFor(state, cards) };
}
