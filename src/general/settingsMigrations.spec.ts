import { describe, it, expect } from "vitest";
import { migrateSettings, CURRENT_SETTINGS_VERSION } from "./settingsMigrations";

describe("migrateSettings", () => {
  it("backfills webresourceSolutionName and stamps the current version", () => {
    const { settings, applied, fromNewerVersion } = migrateSettings({ solutionName: "Core" });
    expect(settings.webresourceSolutionName).toBe("Core");
    expect(settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    expect(applied).toHaveLength(1);
    expect(fromNewerVersion).toBe(false);
  });

  it("is idempotent — a current-version file applies nothing", () => {
    const once = migrateSettings({ solutionName: "Core" }).settings;
    const twice = migrateSettings(once);
    expect(twice.applied).toEqual([]);
    expect(twice.settings).toEqual(once);
  });

  it("does not overwrite an explicit webresourceSolutionName", () => {
    const { settings } = migrateSettings({ solutionName: "Core", webresourceSolutionName: "Other" });
    expect(settings.webresourceSolutionName).toBe("Other");
  });

  it("flags files written by a newer extension and leaves them untouched", () => {
    const raw = { settingsVersion: CURRENT_SETTINGS_VERSION + 5, futureField: "x" };
    const { settings, fromNewerVersion, applied } = migrateSettings(raw);
    expect(fromNewerVersion).toBe(true);
    expect(applied).toEqual([]);
    expect(settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION + 5);
  });
});
