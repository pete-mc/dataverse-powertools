import { describe, it, expect } from "vitest";
import { CUSTOM_CONTROL_COMPONENT_TYPE, controlNameFromManifest, customControlResource, matchesControlName } from "./deployPcf";

// #256: "Add to Solution" used to demand a Solution PROJECT (.cdsproj) in the workspace — PCF was the
// only component type that did. A web resource (component type 61) and a plug-in step (92) are added to
// the solution named in the connection settings over the Web API, with no project anywhere. These pin
// the pieces that make PCF behave the same way.

describe("CUSTOM_CONTROL_COMPONENT_TYPE", () => {
  it("is 66 — the solution component type for a customcontrol", () => {
    expect(CUSTOM_CONTROL_COMPONENT_TYPE).toBe(66);
  });
});

describe("controlNameFromManifest", () => {
  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest>
  <control namespace="SampleNamespace" constructor="SampleControl" version="0.0.1" display-name-key="SampleControl">
  </control>
</manifest>`;

  it("builds the <namespace>.<constructor> name the customcontrol row carries", () => {
    expect(controlNameFromManifest(manifest)).toBe("SampleNamespace.SampleControl");
  });

  it("returns undefined when either half is missing, so we never query for a half-formed name", () => {
    expect(controlNameFromManifest(`<control namespace="OnlyNs" />`)).toBeUndefined();
    expect(controlNameFromManifest(`<control constructor="OnlyCtor" />`)).toBeUndefined();
    expect(controlNameFromManifest("")).toBeUndefined();
  });
});

// Dataverse stores the control PREFIXED with the publisher's customization prefix — a manifest of
// namespace="SampleNamespace" constructor="SampleControl" lands as "dvpt_SampleNamespace.SampleControl".
// An equality filter on the manifest name therefore never matches, which made a SUCCESSFUL push look
// like "not in the environment yet".
describe("customControlResource", () => {
  it("matches on the SUFFIX, because the stored name carries a publisher prefix", () => {
    expect(customControlResource("Ns.Ctl")).toContain("endswith(name,'Ns.Ctl')");
    expect(customControlResource("Ns.Ctl")).toContain("$select=customcontrolid,name");
  });

  it("escapes a quote in the name rather than building broken OData", () => {
    expect(customControlResource("N's.Ctl")).toContain("endswith(name,'N''s.Ctl')");
  });
});

describe("matchesControlName", () => {
  it("accepts the prefixed name Dataverse actually stores", () => {
    expect(matchesControlName("dvpt_SampleNamespace.SampleControl", "SampleNamespace.SampleControl")).toBe(true);
  });

  it("accepts an unprefixed name too", () => {
    expect(matchesControlName("SampleNamespace.SampleControl", "SampleNamespace.SampleControl")).toBe(true);
  });

  it("rejects a different control that merely ends similarly", () => {
    expect(matchesControlName("dvpt_OtherNamespace.SampleControl", "SampleNamespace.SampleControl")).toBe(false);
    expect(matchesControlName("XSampleNamespace.SampleControl", "SampleNamespace.SampleControl")).toBe(false);
  });
});
