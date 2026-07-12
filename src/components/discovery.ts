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
