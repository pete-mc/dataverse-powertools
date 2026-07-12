// Central, ordered, idempotent migrations for dataverse-powertools.json (#71).
// Pure — used by context.readSettings AND component discovery, so root and
// subfolder components migrate identically. `settingsVersion` is the explicit
// schema version (integer, monotonic), independent of `templateversion` (which
// describes the scaffolded template shape, not the settings schema).
//
// Migrations that need to touch SIBLING project files (spkl.json,
// modelbuilder.json) do it through an injected MigrationIo — the module stays
// pure/unit-testable, the callers (context.readSettings, componentDiscovery)
// supply an fs-backed io rooted at the component folder.

import { parseSolutionConfig } from "../solution/solutionConfig";

export const CURRENT_SETTINGS_VERSION = 2;

/** File access rooted at the component folder, injected by impure callers. */
export interface MigrationIo {
  /** File content, or undefined when absent/unreadable. */
  readProjectFile(name: string): string | undefined;
  writeProjectFile(name: string, content: string): void;
  projectFileExists(name: string): boolean;
}

export interface SettingsMigrationResult {
  settings: Record<string, unknown>;
  /** Names of migrations applied this load (for logging). */
  applied: string[];
  /** True when the file was written by a NEWER extension — warn, don't touch. */
  fromNewerVersion: boolean;
}

interface SettingsMigration {
  toVersion: number;
  name: string;
  /** io is undefined for pure callers (unit tests) — io-dependent migrations
   * must no-op then, NOT half-apply. Production callers always supply io. */
  migrate(settings: Record<string, unknown>, io?: MigrationIo): void;
}

const MODEL_BUILDER_FILENAME = "modelbuilder.json";

const MIGRATIONS: SettingsMigration[] = [
  {
    toVersion: 1,
    name: "backfill webresourceSolutionName from solutionName",
    migrate(settings) {
      if (!settings.webresourceSolutionName && settings.solutionName) {
        settings.webresourceSolutionName = settings.solutionName;
      }
    },
  },
  {
    toVersion: 2,
    name: "retire the 1.1 float templateversion (solutions -> 2)",
    migrate(settings) {
      // Solutions were created with templateversion 1.1 — a FLOAT compared with
      // === in four files. Integer 2 is the same template content.
      if (settings.templateversion === 1.1) {
        settings.templateversion = 2;
      }
    },
  },
  {
    toVersion: 2,
    name: "import legacy spkl.json into settings.solutionConfig",
    migrate(settings, io) {
      if ((settings.solutionConfig as { uniqueName?: string } | undefined)?.uniqueName || !io) {
        return;
      }
      const spkl = io.readProjectFile("spkl.json");
      if (!spkl) {
        return;
      }
      const config = parseSolutionConfig(spkl);
      if (config) {
        settings.solutionConfig = config;
      }
    },
  },
  {
    toVersion: 2,
    name: "move pluginModelBuilder out to modelbuilder.json",
    migrate(settings, io) {
      if (!settings.pluginModelBuilder || typeof settings.pluginModelBuilder !== "object" || !io) {
        return;
      }
      // modelbuilder.json is authoritative once it exists — never overwrite it
      // with the (older) copy embedded in settings.
      if (!io.projectFileExists(MODEL_BUILDER_FILENAME)) {
        io.writeProjectFile(MODEL_BUILDER_FILENAME, `${JSON.stringify(settings.pluginModelBuilder, undefined, 2)}\n`);
      }
      delete settings.pluginModelBuilder;
    },
  },
];

export function migrateSettings(raw: Record<string, unknown>, io?: MigrationIo): SettingsMigrationResult {
  const settings = { ...raw };
  const version = typeof settings.settingsVersion === "number" ? settings.settingsVersion : 0;
  if (version > CURRENT_SETTINGS_VERSION) {
    return { settings, applied: [], fromNewerVersion: true };
  }
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (version < migration.toVersion) {
      migration.migrate(settings, io);
      applied.push(migration.name);
    }
  }
  settings.settingsVersion = CURRENT_SETTINGS_VERSION;
  return { settings, applied, fromNewerVersion: false };
}
