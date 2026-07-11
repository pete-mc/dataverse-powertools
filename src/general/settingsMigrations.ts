// Central, ordered, idempotent migrations for dataverse-powertools.json (#71).
// Pure — used by context.readSettings AND component discovery, so root and
// subfolder components migrate identically. `settingsVersion` is the explicit
// schema version (integer, monotonic), independent of `templateversion` (which
// describes the scaffolded template shape, not the settings schema).

export const CURRENT_SETTINGS_VERSION = 1;

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
  migrate(settings: Record<string, unknown>): void;
}

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
];

export function migrateSettings(raw: Record<string, unknown>): SettingsMigrationResult {
  const settings = { ...raw };
  const version = typeof settings.settingsVersion === "number" ? settings.settingsVersion : 0;
  if (version > CURRENT_SETTINGS_VERSION) {
    return { settings, applied: [], fromNewerVersion: true };
  }
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (version < migration.toVersion) {
      migration.migrate(settings);
      applied.push(migration.name);
    }
  }
  settings.settingsVersion = CURRENT_SETTINGS_VERSION;
  return { settings, applied, fromNewerVersion: false };
}
