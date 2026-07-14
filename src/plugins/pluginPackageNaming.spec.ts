import { describe, it, expect } from "vitest";
import { normalizeCustomizationPrefix, sanitizeUniqueNameSegment, prefixedPackageId, pluginPackageUniqueName } from "./pluginPackageNaming";

describe("normalizeCustomizationPrefix", () => {
  it("keeps a normal alpha prefix", () => {
    expect(normalizeCustomizationPrefix("dvpt")).toBe("dvpt");
  });
  it("defaults to dpt when empty/blank", () => {
    expect(normalizeCustomizationPrefix(undefined)).toBe("dpt");
    expect(normalizeCustomizationPrefix("   ")).toBe("dpt");
    expect(normalizeCustomizationPrefix("__")).toBe("dpt");
  });
  it("prepends p when the prefix starts with a digit", () => {
    expect(normalizeCustomizationPrefix("123")).toBe("p123");
  });
});

describe("sanitizeUniqueNameSegment", () => {
  it("replaces illegal chars and collapses/trims underscores", () => {
    expect(sanitizeUniqueNameSegment("My Plugin!")).toBe("My_Plugin");
    expect(sanitizeUniqueNameSegment("__a..b__")).toBe("a_b");
  });
});

describe("prefixedPackageId (#134 — deterministic package id)", () => {
  it("is always prefixed, using the configured package name", () => {
    expect(prefixedPackageId("dvpt", "MyPkg", "Plugin")).toBe("dvpt_MyPkg");
  });
  it("falls back to the csproj base name when no package name is configured", () => {
    expect(prefixedPackageId("dvpt", "", "Plugin")).toBe("dvpt_Plugin");
    expect(prefixedPackageId("dvpt", undefined, "Plugin")).toBe("dvpt_Plugin");
  });
  it("uses the default prefix when none is set — never an unprefixed id", () => {
    // The bug: sometimes the package was "Plugin.1.0.0.nupkg" (no prefix). The id must
    // ALWAYS carry a prefix so Build and Build & Deploy agree.
    expect(prefixedPackageId(undefined, "", "Plugin")).toBe("dpt_Plugin");
    expect(prefixedPackageId("", "", "Plugin").includes("_")).toBe(true);
  });
  it("is stable across the varying inputs (prefix, name, csproj)", () => {
    expect(prefixedPackageId("dvpt", "MyPkg", "SomethingElse")).toBe("dvpt_MyPkg");
  });
});

describe("pluginPackageUniqueName", () => {
  it("prefixes an unprefixed package name", () => {
    expect(pluginPackageUniqueName("dvpt", "MyPkg")).toBe("dvpt_MyPkg");
  });
  it("leaves an already-prefixed name untouched", () => {
    expect(pluginPackageUniqueName("dvpt", "dvpt_MyPkg")).toBe("dvpt_MyPkg");
  });
  it("falls back to pluginpackage for an empty name", () => {
    expect(pluginPackageUniqueName("dvpt", "")).toBe("dvpt_pluginpackage");
  });
  it("truncates to 128 chars", () => {
    expect(pluginPackageUniqueName("dvpt", "a".repeat(200)).length).toBe(128);
  });
});
