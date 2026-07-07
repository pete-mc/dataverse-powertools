/* eslint-disable @typescript-eslint/naming-convention -- fixtures use real spkl.json keys (solution_uniquename, packagepath, packagetype) */
import { describe, it, expect } from "vitest";
import { mapSpklPackageType, managedZipPath, parseSolutionConfig } from "./solutionConfig";

describe("mapSpklPackageType", () => {
  it("maps spkl values to SolutionPackager types", () => {
    expect(mapSpklPackageType("both_unmanaged_import")).toBe("Both");
    expect(mapSpklPackageType("unmanaged")).toBe("Unmanaged");
    expect(mapSpklPackageType("managed")).toBe("Managed");
  });

  it("prefers Both, then Unmanaged, when the string is ambiguous", () => {
    // "both_unmanaged_import" contains both "both" and "unmanaged"; Both wins.
    expect(mapSpklPackageType("BOTH")).toBe("Both");
    expect(mapSpklPackageType("managed_and_unmanaged")).toBe("Unmanaged");
  });

  it("defaults to Unmanaged for missing/unknown values", () => {
    expect(mapSpklPackageType(undefined)).toBe("Unmanaged");
    expect(mapSpklPackageType("")).toBe("Unmanaged");
    expect(mapSpklPackageType("something")).toBe("Unmanaged");
  });
});

describe("managedZipPath", () => {
  it("inserts _managed before the .zip extension", () => {
    expect(managedZipPath("bin/MySolution.zip")).toBe("bin/MySolution_managed.zip");
    expect(managedZipPath("bin/MySolution.ZIP")).toBe("bin/MySolution_managed.zip");
  });
});

describe("parseSolutionConfig", () => {
  it("parses a standard spkl.json", () => {
    const cfg = parseSolutionConfig(
      JSON.stringify({
        solutions: [{ solution_uniquename: "MySolution", packagepath: "src/MySolution", packagetype: "both_unmanaged_import" }],
      }),
    );
    expect(cfg).toEqual({ uniqueName: "MySolution", packagePath: "src/MySolution", zipPath: "bin/MySolution.zip", packageType: "Both" });
  });

  it("falls back to the unique name when packagepath is missing", () => {
    const cfg = parseSolutionConfig(JSON.stringify({ solutions: [{ solution_uniquename: "MySolution", packagetype: "unmanaged" }] }));
    expect(cfg?.packagePath).toBe("MySolution");
    expect(cfg?.packageType).toBe("Unmanaged");
  });

  it("returns undefined when there is no usable solution entry", () => {
    expect(parseSolutionConfig(JSON.stringify({ solutions: [] }))).toBeUndefined();
    expect(parseSolutionConfig(JSON.stringify({ solutions: [{ packagepath: "x" }] }))).toBeUndefined();
    expect(parseSolutionConfig("{}")).toBeUndefined();
    expect(parseSolutionConfig("not json")).toBeUndefined();
  });
});
