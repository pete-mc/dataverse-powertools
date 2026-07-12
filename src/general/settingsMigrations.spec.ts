/* eslint-disable @typescript-eslint/naming-convention -- fixture keys are literal file names / spkl schema fields */
import { describe, it, expect } from "vitest";
import { migrateSettings, CURRENT_SETTINGS_VERSION, MigrationIo } from "./settingsMigrations";

/** In-memory MigrationIo for the io-dependent migrations. */
function fakeIo(files: Record<string, string> = {}): MigrationIo & { files: Record<string, string> } {
  return {
    files,
    readProjectFile(name) {
      return files[name];
    },
    writeProjectFile(name, content) {
      files[name] = content;
    },
    projectFileExists(name) {
      return name in files;
    },
  };
}

const SPKL = JSON.stringify({
  solutions: [{ solution_uniquename: "TestSolution", packagepath: "solution\\src", packagetype: "both_unmanaged_import" }],
});

describe("migrateSettings", () => {
  it("backfills webresourceSolutionName and stamps the current version", () => {
    const { settings, applied, fromNewerVersion } = migrateSettings({ solutionName: "Core" });
    expect(settings.webresourceSolutionName).toBe("Core");
    expect(settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    expect(applied.length).toBeGreaterThan(0);
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

  it("retires the 1.1 float templateversion to integer 2", () => {
    const { settings } = migrateSettings({ type: "solution", templateversion: 1.1 });
    expect(settings.templateversion).toBe(2);
    // Other types' integer versions are untouched.
    expect(migrateSettings({ type: "plugin", templateversion: 3 }).settings.templateversion).toBe(3);
  });

  it("imports a legacy spkl.json into settings.solutionConfig", () => {
    const io = fakeIo({ "spkl.json": SPKL });
    const { settings } = migrateSettings({ type: "solution" }, io);
    expect((settings.solutionConfig as { uniqueName: string }).uniqueName).toBe("TestSolution");
  });

  it("never overwrites an existing solutionConfig with spkl.json", () => {
    const io = fakeIo({ "spkl.json": SPKL });
    const { settings } = migrateSettings({ solutionConfig: { uniqueName: "Configured" } }, io);
    expect((settings.solutionConfig as { uniqueName: string }).uniqueName).toBe("Configured");
  });

  it("moves pluginModelBuilder out to modelbuilder.json and drops it from settings", () => {
    const io = fakeIo();
    const { settings } = migrateSettings({ type: "plugin", pluginModelBuilder: { namespace: "Contoso" } }, io);
    expect(settings.pluginModelBuilder).toBeUndefined();
    expect(JSON.parse(io.files["modelbuilder.json"]).namespace).toBe("Contoso");
  });

  it("keeps an existing modelbuilder.json authoritative (drops the stale settings copy)", () => {
    const io = fakeIo({ "modelbuilder.json": JSON.stringify({ namespace: "Existing" }) });
    const { settings } = migrateSettings({ pluginModelBuilder: { namespace: "Stale" } }, io);
    expect(settings.pluginModelBuilder).toBeUndefined();
    expect(JSON.parse(io.files["modelbuilder.json"]).namespace).toBe("Existing");
  });

  it("io-dependent migrations no-op (not half-apply) without io", () => {
    const { settings } = migrateSettings({ pluginModelBuilder: { namespace: "X" } });
    expect(settings.pluginModelBuilder).toEqual({ namespace: "X" });
    expect(settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
  });

  it("a version-1 file only gets the version-2 migrations", () => {
    const io = fakeIo({ "spkl.json": SPKL });
    const { applied } = migrateSettings({ settingsVersion: 1, type: "solution" }, io);
    expect(applied.some((name) => name.includes("webresourceSolutionName"))).toBe(false);
    expect(applied.some((name) => name.includes("spkl"))).toBe(true);
  });
});
