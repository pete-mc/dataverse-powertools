import { describe, expect, it } from "vitest";
import {
  profilerInstalledQuery,
  pluginProfilesQuery,
  pluginProfileContentQuery,
  activeProfilesQuery,
  parseActiveProfiles,
  profiledStepTypeLabel,
  findMatchingStep,
  buildProfilableStepsResource,
  pluginAssemblyProfilingQuery,
} from "./pluginProfiles";

describe("plugin profile queries", () => {
  it("detects the profiler by its solution unique name", () => {
    expect(profilerInstalledQuery()).toBe("solutions?$select=solutionid,version&$filter=uniquename eq 'PluginProfiler'");
  });

  describe("buildProfilableStepsResource", () => {
    it("keeps the base plugin-step filter (active, real plugin type) and a $top", () => {
      const q = buildProfilableStepsResource();
      expect(q).toContain("sdkmessageprocessingsteps?$select=name,mode,statecode");
      expect(q).toContain("statecode eq 0");
      expect(q).toContain("_plugintypeid_value ne null");
      expect(q).toContain("$expand=sdkmessageid");
      expect(q).toContain("$top=200");
      expect(q).not.toContain("pluginassemblyid/name eq");
    });

    it("filters SERVER-SIDE by assembly so a busy org's 200 system steps can't hide the user's step", () => {
      const q = buildProfilableStepsResource("MyPlugins");
      expect(q).toContain("plugintypeid/pluginassemblyid/name eq 'MyPlugins'");
    });

    it("escapes single quotes in the assembly name", () => {
      expect(buildProfilableStepsResource("O'Brien")).toContain("plugintypeid/pluginassemblyid/name eq 'O''Brien'");
    });
  });

  describe("pluginAssemblyProfilingQuery (package-assembly profiling prep)", () => {
    it("selects id, content, and the package lookup so capture can populate a package assembly's content", () => {
      const q = pluginAssemblyProfilingQuery("MyPlugins");
      expect(q).toContain("pluginassemblies?$select=pluginassemblyid,content,_packageid_value");
      expect(q).toContain("$filter=name eq 'MyPlugins'");
      expect(q).toContain("$top=1");
    });

    it("escapes single quotes in the assembly name", () => {
      expect(pluginAssemblyProfilingQuery("O'Brien")).toContain("name eq 'O''Brien'");
    });
  });

  it("lists profiles newest first without the heavy report column", () => {
    const query = pluginProfilesQuery(25);
    expect(query).toContain("mbs_pluginprofiles?$select=");
    expect(query).toContain("$orderby=createdon desc");
    expect(query).toContain("$top=25");
    expect(query).not.toContain("mbs_profile,");
  });

  it("fetches one profile's report by GUID only", () => {
    expect(pluginProfileContentQuery("11111111-2222-3333-4444-555555555555")).toBe("mbs_pluginprofiles(11111111-2222-3333-4444-555555555555)?$select=mbs_profile");
    expect(() => pluginProfileContentQuery("1 or true")).toThrow(/Not a plugin profile id/);
  });
});

describe("active plugin profiles (#139)", () => {
  it("filters to the profiler's (Profiled) clones server-side and re-checks the marker", () => {
    const q = activeProfilesQuery();
    expect(q).toContain("sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,mode");
    expect(q).toContain("contains(name,'(Profiled)')");
    expect(q).toContain("statecode eq 0");
  });

  it("parses profiled clones, keeping only the marked rows", () => {
    const rows = parseActiveProfiles({
      value: [
        {
          sdkmessageprocessingstepid: "11111111-1111-1111-1111-111111111111",
          name: "Acme.UpdatePlugin: Update of account (Profiled)",
          mode: 0,
          sdkmessageid: { name: "Update" },
          sdkmessagefilterid: { primaryobjecttypecode: "account" },
        },
        { sdkmessageprocessingstepid: "22222222-2222-2222-2222-222222222222", name: "Acme.OtherPlugin: Create of contact", mode: 1 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      profilerStepId: "11111111-1111-1111-1111-111111111111",
      typeName: "Acme.UpdatePlugin",
      message: "Update",
      primaryEntity: "account",
      mode: 0,
    });
  });

  it("labels a profiled clone by its type part, tolerating no colon", () => {
    expect(profiledStepTypeLabel("Acme.Plugin: Update of account (Profiled)")).toBe("Acme.Plugin");
    expect(profiledStepTypeLabel("Just A Name (Profiled)")).toBe("Just A Name");
  });

  it("matches a registration to a step by message + entity, disambiguating by type", () => {
    const steps = [
      { message: "Update", primaryEntity: "account", typeName: "Acme.AccountPlugin" },
      { message: "Update", primaryEntity: "account", typeName: "Acme.OtherPlugin" },
      { message: "Create", primaryEntity: "contact", typeName: "Acme.ContactPlugin" },
    ];
    expect(findMatchingStep(steps, { message: "Create", primaryEntity: "contact" })?.typeName).toBe("Acme.ContactPlugin");
    expect(findMatchingStep(steps, { message: "Update", primaryEntity: "account", typeName: "OtherPlugin" })?.typeName).toBe("Acme.OtherPlugin");
    expect(findMatchingStep(steps, { message: "Delete", primaryEntity: "account" })).toBeUndefined();
  });
});
