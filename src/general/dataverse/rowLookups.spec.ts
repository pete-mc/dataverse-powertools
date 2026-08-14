import { describe, it, expect } from "vitest";
import { customControlLookup, pluginTraceLogLookup, pluginTypeLookup, pickMatchingRow } from "./rowLookups";

// The strings below are REAL values read out of a Dataverse environment, not invented ones. Each of
// these lookups was written the obvious way first (`name eq '<what you passed in>'`), shipped, and then
// failed live — so the point of these tests is to pin the shapes, not the syntax.

describe("customControlLookup", () => {
  const lookup = customControlLookup("SampleNamespace.SampleControl");

  it("queries on the suffix, because the stored name carries a publisher prefix", () => {
    expect(lookup.resource).toContain("endswith(name,'SampleNamespace.SampleControl')");
  });

  it("matches the prefixed name Dataverse actually stores", () => {
    // Observed: `dvpt_SampleNamespace.SampleControl`
    expect(lookup.matches("dvpt_SampleNamespace.SampleControl")).toBe(true);
  });

  it("matches an unprefixed name too", () => {
    expect(lookup.matches("SampleNamespace.SampleControl")).toBe(true);
  });

  it("rejects a different control the suffix query would also return", () => {
    expect(lookup.matches("dvpt_OtherNamespace.SampleControl")).toBe(false);
    expect(lookup.matches("XSampleNamespace.SampleControl")).toBe(false);
  });
});

describe("pluginTraceLogLookup", () => {
  const lookup = pluginTraceLogLookup("ContosoTerritories.TerritoryOnboarding");

  it("queries on the prefix, because typename is assembly-qualified", () => {
    expect(lookup.resource).toContain("startswith(typename,'ContosoTerritories.TerritoryOnboarding')");
  });

  it("matches the assembly-qualified name Dataverse actually stores", () => {
    // Observed: `ContosoTerritories.TerritoryOnboarding, ContosoTerritories, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null`
    expect(lookup.matches("ContosoTerritories.TerritoryOnboarding, ContosoTerritories, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null")).toBe(true);
  });

  it("rejects a longer type that merely starts the same way", () => {
    // `startswith` would return this row; the comma boundary is what rules it out.
    expect(lookup.matches("ContosoTerritories.TerritoryOnboardingExtra, ContosoTerritories, Version=1.0.0.0")).toBe(false);
  });
});

describe("pluginTypeLookup", () => {
  const lookup = pluginTypeLookup("ContosoTerritories.TerritoryOnboarding");

  // Deliberately NOT a suffix/prefix query: plugintype stores the plain name, and this is recorded so
  // nobody "corrects" it to match the other two.
  it("is an exact match, because plugintype stores the plain type name", () => {
    expect(lookup.resource).toContain("typename eq 'ContosoTerritories.TerritoryOnboarding'");
    expect(lookup.matches("ContosoTerritories.TerritoryOnboarding")).toBe(true);
    expect(lookup.matches("ContosoTerritories.TerritoryOnboarding, ContosoTerritories, Version=1.0.0.0")).toBe(false);
  });
});

describe("escaping", () => {
  it("escapes a quote in every lookup rather than building broken OData", () => {
    expect(customControlLookup("N's.Ctl").resource).toContain("endswith(name,'N''s.Ctl')");
    expect(pluginTraceLogLookup("N's.Type").resource).toContain("startswith(typename,'N''s.Type')");
    expect(pluginTypeLookup("N's.Type").resource).toContain("typename eq 'N''s.Type'");
  });
});

describe("pickMatchingRow", () => {
  const lookup = customControlLookup("SampleNamespace.SampleControl");

  it("picks the right row out of what the suffix query returned", () => {
    const rows = [
      { name: "dvpt_OtherNamespace.SampleControl", customcontrolid: "wrong" },
      { name: "dvpt_SampleNamespace.SampleControl", customcontrolid: "right" },
    ];
    expect(pickMatchingRow(rows, lookup, "name")?.customcontrolid).toBe("right");
  });

  it("returns undefined when nothing genuinely matches, rather than the first row", () => {
    expect(pickMatchingRow([{ name: "dvpt_OtherNamespace.SampleControl" }], lookup, "name")).toBeUndefined();
    expect(pickMatchingRow([], lookup, "name")).toBeUndefined();
    expect(pickMatchingRow(undefined, lookup, "name")).toBeUndefined();
  });
});
