import { describe, expect, it } from "vitest";
import {
  profilerInstalledQuery,
  pluginProfilesQuery,
  pluginProfileContentQuery,
  activeProfilesQuery,
  parseActiveProfiles,
  profiledStepTypeLabel,
  findMatchingStep,
} from "./pluginProfiles";

describe("plugin profile queries", () => {
  it("detects the profiler by its solution unique name", () => {
    expect(profilerInstalledQuery()).toBe("solutions?$select=solutionid,version&$filter=uniquename eq 'PluginProfiler'");
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
