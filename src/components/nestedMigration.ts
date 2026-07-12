// Pure planning for the single-project → nested multi-component migration.
//
// When a workspace whose ROOT is itself a typed project (today's single-project
// layout) adds a second component, the user can switch to the nested layout:
// the existing project moves into a subfolder, the root becomes a
// connection-only "blank" component, and the new component is added alongside.
// This module decides WHAT moves and HOW the settings split; the vscode/fs
// work stays in addComponent.ts. Unit-tested in nestedMigration.spec.ts.

import { ComponentSettings } from "./discovery";

/** Workspace-level entries that stay at the root when the project moves into a
 * subfolder: version control and VS Code's workspace config. The settings file
 * is rewritten on both sides rather than moved. */
const KEEP_AT_ROOT = new Set([".git", ".vscode", "dataverse-powertools.json"]);

/** The root directory entries to move into the new component subfolder. */
export function planNestedMigrationMoves(rootEntries: string[], destinationFolder: string): string[] {
  return rootEntries.filter((entry) => !KEEP_AT_ROOT.has(entry) && entry !== destinationFolder);
}

/** Connection fields that live on the connection-only root; subfolder components
 * inherit them (see INHERITED_FIELDS in discovery.ts). solutionName and
 * settingsVersion are kept on BOTH sides — components carry their own solution
 * binding, and every settings file migrates independently (#71). */
const ROOT_FIELDS = new Set(["connectionString", "tenantId", "prefix", "solutionName", "environmentLabel", "settingsVersion"]);
const SHARED_FIELDS = new Set(["solutionName", "settingsVersion"]);

/** Split the current root settings into the new connection-only root file and the
 * moved component's file (type + everything project-specific, no connection —
 * so later environment switches at the root propagate to the component). */
export function splitSettingsForNestedMigration(settings: ComponentSettings): { rootSettings: ComponentSettings; componentSettings: ComponentSettings } {
  const rootSettings: ComponentSettings = {};
  const componentSettings: ComponentSettings = {};
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) {
      continue;
    }
    if (ROOT_FIELDS.has(key)) {
      rootSettings[key] = value;
    }
    if (!ROOT_FIELDS.has(key) || SHARED_FIELDS.has(key)) {
      componentSettings[key] = value;
    }
  }
  return { rootSettings, componentSettings };
}
