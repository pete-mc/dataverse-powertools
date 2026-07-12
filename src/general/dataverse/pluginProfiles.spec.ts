import { describe, expect, it } from "vitest";
import { profilerInstalledQuery, pluginProfilesQuery, pluginProfileContentQuery } from "./pluginProfiles";

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
