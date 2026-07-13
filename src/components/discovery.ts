// Component discovery for multi-component workspaces (#47 phase 3).
//
// A component is a folder containing dataverse-powertools.json. Today's
// single-project workspace is the degenerate case: exactly one settings file at
// the workspace root. This module is pure (no vscode/fs) — callers find the
// settings files (vscode.workspace.findFiles) and read their contents; this
// resolves them into components with root-file inheritance and provides
// path→component resolution. Unit-tested in discovery.spec.ts.

import { migrateSettings, MigrationIo } from "../general/settingsMigrations";

/** The parsed shape of a component's dataverse-powertools.json (loosely typed —
 * the full ProjectSettings interface lives in context.ts, which imports vscode). */
export interface ComponentSettings {
  type?: string;
  templateversion?: number;
  connectionString?: string;
  tenantId?: string;
  prefix?: string;
  solutionName?: string;
  environmentLabel?: string;
  environmentId?: string;
  /** Sidebar arrangement (#118) — only meaningful on the root (Empty) component. */
  layout?: Layout;
  [key: string]: unknown;
}

export interface DiscoveredComponent {
  /** Normalised absolute folder containing the settings file (forward slashes, no trailing slash). */
  root: string;
  /** Folder relative to the workspace root; "" for the root component. */
  relativeRoot: string;
  /** True for the workspace-root component (today's single-project layout). */
  isRoot: boolean;
  settings: ComponentSettings;
}

export interface DiscoveryResult {
  /** Root component first, then by path depth, then lexicographically. */
  components: DiscoveredComponent[];
  /** Settings files that failed to parse (reported, never fatal). */
  malformed: string[];
}

/** Normalise a path for comparison: forward slashes, no trailing slash, lower-cased drive letter. */
export function normalizeFsPath(fsPath: string): string {
  let normalized = fsPath.replace(/\\/g, "/");
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return /^[A-Z]:/.test(normalized) ? normalized[0].toLowerCase() + normalized.slice(1) : normalized;
}

function parentDirectory(filePath: string): string {
  const normalized = normalizeFsPath(filePath);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? normalized : normalized.slice(0, index);
}

/** Fields a subfolder component inherits from the ROOT settings file when it
 * doesn't set them itself: the connection and its non-secret companions.
 * (One environment per workspace in v1 — see the #47 design comment.) */
const INHERITED_FIELDS = ["connectionString", "tenantId", "prefix", "environmentLabel", "environmentId"] as const;

/**
 * Resolve discovered settings files into components.
 * @param workspaceRoot absolute workspace folder
 * @param settingsFiles each discovered dataverse-powertools.json path + raw content
 */
export function resolveComponents(
  workspaceRoot: string,
  settingsFiles: { path: string; content: string }[],
  // Impure callers supply fs-backed io per component so io-dependent migrations
  // (spkl.json import, modelbuilder.json move-out) run during discovery too.
  ioForComponent?: (componentRoot: string) => MigrationIo,
): DiscoveryResult {
  const root = normalizeFsPath(workspaceRoot);
  const malformed: string[] = [];
  const components: DiscoveredComponent[] = [];

  for (const file of settingsFiles) {
    let settings: ComponentSettings;
    try {
      settings = JSON.parse(file.content) as ComponentSettings;
    } catch {
      malformed.push(file.path);
      continue;
    }
    const componentRoot = parentDirectory(file.path);
    if (componentRoot !== root && !componentRoot.startsWith(root + "/")) {
      continue; // outside the workspace — not ours
    }
    const relativeRoot = componentRoot === root ? "" : componentRoot.slice(root.length + 1);
    components.push({ root: componentRoot, relativeRoot, isRoot: relativeRoot === "", settings });
  }

  components.sort((a, b) => {
    if (a.isRoot !== b.isRoot) {
      return a.isRoot ? -1 : 1;
    }
    const depthDelta = a.relativeRoot.split("/").length - b.relativeRoot.split("/").length;
    return depthDelta !== 0 ? depthDelta : a.relativeRoot.localeCompare(b.relativeRoot);
  });

  // Root-file inheritance: subfolder components without their own connection
  // inherit the root's. (A fully self-contained subfolder keeps its own.)
  const rootComponent = components.find((c) => c.isRoot);
  if (rootComponent) {
    for (const component of components) {
      if (component.isRoot || component.settings.connectionString) {
        continue;
      }
      for (const field of INHERITED_FIELDS) {
        if (component.settings[field] === undefined && rootComponent.settings[field] !== undefined) {
          component.settings[field] = rootComponent.settings[field];
        }
      }
    }
  }

  // Run the central settings migrations (#71) so subfolder components behave
  // exactly like the root one (context.readSettings migrates the root file).
  for (const component of components) {
    component.settings = migrateSettings(component.settings, ioForComponent?.(component.root)).settings as ComponentSettings;
  }

  return { components, malformed };
}

/** The component owning a file/folder path: the component with the LONGEST root
 * that is a prefix of the path. Undefined when the path is outside all components. */
export function componentForPath(components: DiscoveredComponent[], fsPath: string): DiscoveredComponent | undefined {
  const normalized = normalizeFsPath(fsPath);
  let best: DiscoveredComponent | undefined;
  for (const component of components) {
    if (normalized === component.root || normalized.startsWith(component.root + "/")) {
      if (!best || component.root.length > best.root.length) {
        best = component;
      }
    }
  }
  return best;
}

/** Components of a given project type (registry id). */
export function componentsOfType(components: DiscoveredComponent[], type: string): DiscoveredComponent[] {
  return components.filter((c) => c.settings.type === type);
}

/** User-arranged sidebar layout (#118), stored on the root (Empty) component's
 * dataverse-powertools.json. relativeRoots identify components. */
export interface LayoutGroup {
  name: string;
  members: string[];
  collapsed?: boolean;
}
export interface Layout {
  /** Display order of components, by relativeRoot. Unlisted ones append (discovery order). */
  order?: string[];
  /** Named groups; a component belongs to at most one (first that lists it). */
  groups?: LayoutGroup[];
}

/** One top-level row of the arranged sidebar: a standalone item or a group. Generic
 * over the item so it serves both DiscoveredComponent and the panel's project cards. */
export type LayoutRow<T> = { kind: "component"; component: T } | { kind: "group"; name: string; collapsed: boolean; components: T[] };

/** The minimum an item needs to be arranged: its relativeRoot id and whether it's the root. */
export interface Arrangeable {
  relativeRoot: string;
  isRoot: boolean;
}

/**
 * Arrange the non-root items into ordered top-level rows per the saved layout (#118). Pure.
 * - Order: `layout.order` (by relativeRoot); items not listed keep their given order after the listed ones.
 * - Groups: a group appears at the position of its first ordered member, with all its members nested (in order).
 * - Stale layout entries (deleted components) are ignored; newly-added components simply append / stay ungrouped.
 */
export function applyLayout<T extends Arrangeable>(components: T[], layout: Layout | undefined): LayoutRow<T>[] {
  const subs = components.filter((c) => !c.isRoot);
  const order = layout?.order ?? [];
  const orderIndex = (c: Arrangeable) => {
    const i = order.indexOf(c.relativeRoot);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const ordered = subs
    .map((c, i) => ({ c, i }))
    .sort((a, b) => orderIndex(a.c) - orderIndex(b.c) || a.i - b.i)
    .map((x) => x.c);

  const groupOf = new Map<string, string>();
  const collapsedOf = new Map<string, boolean>();
  for (const group of layout?.groups ?? []) {
    if (!collapsedOf.has(group.name)) {
      collapsedOf.set(group.name, !!group.collapsed);
    }
    for (const member of group.members) {
      if (!groupOf.has(member)) {
        groupOf.set(member, group.name);
      }
    }
  }

  const rows: LayoutRow<T>[] = [];
  const emitted = new Set<string>();
  for (const component of ordered) {
    const groupName = groupOf.get(component.relativeRoot);
    if (!groupName) {
      rows.push({ kind: "component", component });
    } else if (!emitted.has(groupName)) {
      emitted.add(groupName);
      rows.push({ kind: "group", name: groupName, collapsed: collapsedOf.get(groupName) ?? false, components: ordered.filter((c) => groupOf.get(c.relativeRoot) === groupName) });
    }
  }
  return rows;
}

/** Outcome of resolving which component a command targets (#119). */
export type TargetResolution = { kind: "resolved"; component: DiscoveredComponent } | { kind: "pick"; candidates: DiscoveredComponent[] } | { kind: "none" };

/**
 * Pure resolver for "which component does this command act on?" (#119). The ladder,
 * mirroring VS Code's own resource-command behaviour, is: explicit resource → active
 * editor → picker.
 *
 * - `hintPath` — an explicit target: an Explorer/CodeLens resource path or a panel-card
 *   component root. When present it wins (owning component of the right type, or an exact
 *   root match); it never falls through to active-editor inference.
 * - Exactly one component of the type → that one.
 * - Several, no usable hint → infer from `activeFilePath` (the active editor) when it
 *   belongs to a component of the right type; otherwise ask (`pick`).
 * - None → `none` (the caller decides: legacy unscoped run, or an error).
 */
export function resolveTargetComponent(components: DiscoveredComponent[], type: string, hintPath: string | undefined, activeFilePath: string | undefined): TargetResolution {
  const ofType = componentsOfType(components, type);
  const owningOfType = (fsPath: string | undefined): DiscoveredComponent | undefined => {
    if (!fsPath) {
      return undefined;
    }
    const owner = componentForPath(components, fsPath);
    return owner && owner.settings.type === type ? owner : undefined;
  };

  if (hintPath) {
    // An explicit resource hint wins; a panel-card hint names a root exactly.
    const owner = owningOfType(hintPath) ?? ofType.find((c) => c.root === normalizeFsPath(hintPath));
    if (owner) {
      return { kind: "resolved", component: owner };
    }
    // Hint given but unresolved (e.g. a wrong-type Explorer file) — resolve by count,
    // without active-editor inference (the user pointed at something specific).
    return ofType.length === 1 ? { kind: "resolved", component: ofType[0] } : ofType.length === 0 ? { kind: "none" } : { kind: "pick", candidates: ofType };
  }

  if (ofType.length === 1) {
    return { kind: "resolved", component: ofType[0] };
  }
  if (ofType.length === 0) {
    return { kind: "none" };
  }
  // Several candidates, no hint: infer from the active editor, else ask.
  const active = owningOfType(activeFilePath);
  return active ? { kind: "resolved", component: active } : { kind: "pick", candidates: ofType };
}
