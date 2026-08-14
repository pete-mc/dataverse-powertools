import { describe, it, expect } from "vitest";
import { CUSTOM_CONTROL_COMPONENT_TYPE, controlNameFromManifest } from "./deployPcf";

// #256: "Add to Solution" used to demand a Solution PROJECT (.cdsproj) in the workspace — PCF was the
// only component type that did. A web resource (component type 61) and a plug-in step (92) are added to
// the solution named in the connection settings over the Web API, with no project anywhere.
//
// How the customcontrol ROW is stored (publisher-prefixed) is not tested here any more: it moved to
// general/dataverse/rowLookups.spec.ts, where the product and the e2e client share one definition (#143).

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

  it("builds the <namespace>.<constructor> name the customcontrol row is found by", () => {
    expect(controlNameFromManifest(manifest)).toBe("SampleNamespace.SampleControl");
  });

  it("returns undefined when either half is missing, so we never query for a half-formed name", () => {
    expect(controlNameFromManifest(`<control namespace="OnlyNs" />`)).toBeUndefined();
    expect(controlNameFromManifest(`<control constructor="OnlyCtor" />`)).toBeUndefined();
    expect(controlNameFromManifest("")).toBeUndefined();
  });
});
