import { describe, it, expect } from "vitest";
import { scopedName, scopedIdentifier, assertUsableRunId, profilerStepDisposition, LOCAL_RUN_ID } from "./fixtureNames";

// #258 — the e2e suites share one Dataverse environment, so overlapping runs must not collide.
// These are the naming rules; the suites that apply them only run inside ExTester, so this is
// the only layer that can check the rules cheaply.
describe("e2e fixture names (#258)", () => {
  describe("scopedName", () => {
    it("appends the run id so two runs never share a fixture", () => {
      expect(scopedName("AcceptancePlugin", "1abc2d")).toBe("AcceptancePlugin1abc2d");
      expect(scopedName("AcceptancePlugin", "9zzz1")).toBe("AcceptancePlugin9zzz1");
      expect(scopedName("AcceptancePlugin", "1abc2d")).not.toBe(scopedName("AcceptancePlugin", "9zzz1"));
    });

    it("leaves the name unscoped for a bare local run", () => {
      expect(scopedName("AcceptancePlugin", LOCAL_RUN_ID)).toBe("AcceptancePlugin");
    });

    it("is stable — the same base and run id always give the same name", () => {
      // Cleanup finds rows by rebuilding the name, so this has to hold across calls.
      expect(scopedName("E2EPluginIntPkg", "1abc2d")).toBe(scopedName("E2EPluginIntPkg", "1abc2d"));
    });

    it("keeps distinct bases distinct within one run", () => {
      expect(scopedName("AcceptancePlugin", "1abc2d")).not.toBe(scopedName("CustomApiE2E", "1abc2d"));
    });

    it("suffixes rather than prefixes, so a publisher prefix stays at the front", () => {
      // The deployed package is `{publisherPrefix}_{name}` and web resources are looked up by
      // their leading prefix — anything prepended would break both.
      expect(scopedName("ContosoTerritories", "1abc2d").startsWith("ContosoTerritories")).toBe(true);
    });

    it("refuses an empty base — an unnamed fixture cannot be cleaned up by name", () => {
      expect(() => scopedName("", "1abc2d")).toThrow(/non-empty base/);
    });

    it("refuses a run id that would need escaping in an OData filter", () => {
      expect(() => scopedName("Plugin", "it's")).toThrow(/alphanumeric/);
      expect(() => scopedName("Plugin", "a b")).toThrow(/alphanumeric/);
      expect(() => scopedName("Plugin", "a-b")).toThrow(/alphanumeric/);
    });
  });

  describe("scopedIdentifier", () => {
    it("scopes a name that also has to compile as a C#/TS identifier", () => {
      expect(scopedIdentifier("TerritoryOnboarding", "1abc2d")).toBe("TerritoryOnboarding1abc2d");
      expect(scopedIdentifier("E2EPerFile", LOCAL_RUN_ID)).toBe("E2EPerFile");
    });

    it("stays legal when the run id starts with a digit", () => {
      // Base-36 minutes-since-epoch usually does. A digit is only illegal at the START of an
      // identifier, and the id is a suffix — so this must pass, not throw.
      expect(scopedIdentifier("ContosoTerritories", "1abc2d")).toBe("ContosoTerritories1abc2d");
    });

    it("rejects a base that is not a legal identifier, naming the reason", () => {
      expect(() => scopedIdentifier("acc-plugin", "1abc2d")).toThrow(/legal identifier/);
      expect(() => scopedIdentifier("2Plugins", "1abc2d")).toThrow(/legal identifier/);
      expect(() => scopedIdentifier("", "1abc2d")).toThrow(/legal identifier/);
    });
  });

  // The other half of #258: a cleanup that deletes rows it doesn't own is as damaging as a
  // fixture name that collides — it takes out a concurrent run mid-capture.
  describe("profilerStepDisposition", () => {
    const OURS = "Create territory (DVPT profiler e2e 1abc2d) (Profiler)";
    const THEIRS = "Create territory (DVPT profiler e2e 9zzz1) (Profiler)";

    it("keeps ordinary steps — they belong to the org, not to us", () => {
      expect(profilerStepDisposition("Some business step", "Contoso.Plugins.Thing", "1abc2d")).toBe("keep");
      // Not a clone, even though the run id happens to appear in it.
      expect(profilerStepDisposition("Create territory (DVPT profiler e2e 1abc2d)", "Contoso.Plugins.Thing", "1abc2d")).toBe("keep");
    });

    it("recognises a clone by its plug-in type or by its name suffix", () => {
      expect(profilerStepDisposition("anything", "PluginProfiler.Plugins.ProfilerPlugin")).toBe("delete");
      expect(profilerStepDisposition("Create territory (Profiler)", "Contoso.Plugins.Thing")).toBe("delete");
      expect(profilerStepDisposition("Create territory (Profiled)", "Contoso.Plugins.Thing")).toBe("delete");
    });

    it("deletes this run's clone and spares a concurrent run's", () => {
      expect(profilerStepDisposition(OURS, "PluginProfiler.Plugins.ProfilerPlugin", "1abc2d")).toBe("delete");
      expect(profilerStepDisposition(THEIRS, "PluginProfiler.Plugins.ProfilerPlugin", "1abc2d")).toBe("foreign");
    });

    it("sweeps the entity org-wide when no marker is given (a solo local run)", () => {
      expect(profilerStepDisposition(THEIRS, "PluginProfiler.Plugins.ProfilerPlugin")).toBe("delete");
      expect(profilerStepDisposition(OURS, "PluginProfiler.Plugins.ProfilerPlugin")).toBe("delete");
    });

    it("never reports a non-clone as foreign — 'foreign' must mean a leftover worth warning about", () => {
      // The suite prints a warning per foreign row; classing ordinary org steps as foreign would
      // make that warning noise and get it ignored.
      expect(profilerStepDisposition("Some business step", "Contoso.Plugins.Thing", "1abc2d")).toBe("keep");
    });
  });

  describe("assertUsableRunId", () => {
    it("accepts the local sentinel and any alphanumeric id", () => {
      expect(() => assertUsableRunId(LOCAL_RUN_ID)).not.toThrow();
      expect(() => assertUsableRunId("1abc2d")).not.toThrow();
      expect(() => assertUsableRunId("ABC123")).not.toThrow();
    });

    it("rejects ids that would break a name", () => {
      expect(() => assertUsableRunId("")).toThrow();
      expect(() => assertUsableRunId("run_1")).toThrow();
      expect(() => assertUsableRunId("run.1")).toThrow();
    });
  });
});
