import { describe, it, expect } from "vitest";
import {
  normalizePathForSettings,
  getTemplateForFramework,
  sanitizeClassName,
  getTestBoilerplate,
  tryParseDotNetFrameworkVersion,
  isRunnableModernDotNetTargetFramework,
  resolveCompatibleTestTargetFramework,
  tryParseCSharpLanguageVersion,
} from "./unitTestingLogic";

describe("normalizePathForSettings", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizePathForSettings("a\\b\\c")).toBe("a/b/c");
    expect(normalizePathForSettings("a/b")).toBe("a/b");
  });
});

describe("getTemplateForFramework", () => {
  it("maps each framework to its dotnet template id", () => {
    expect(getTemplateForFramework("mstest")).toBe("mstest");
    expect(getTemplateForFramework("nunit")).toBe("nunit");
    expect(getTemplateForFramework("xunit")).toBe("xunit");
  });
});

describe("sanitizeClassName", () => {
  it("strips illegal characters", () => {
    expect(sanitizeClassName("My-Test Class!")).toBe("MyTestClass");
  });

  it("prefixes Test when it would start with a digit", () => {
    expect(sanitizeClassName("123abc")).toBe("Test123abc");
  });

  it("returns empty string when nothing legal remains", () => {
    expect(sanitizeClassName("   ")).toBe("");
    expect(sanitizeClassName("!!!")).toBe("");
  });

  it("keeps underscores and alphanumerics", () => {
    expect(sanitizeClassName("Valid_Name1")).toBe("Valid_Name1");
  });
});

describe("getTestBoilerplate", () => {
  it("emits MSTest attributes + namespace/class", () => {
    const out = getTestBoilerplate("mstest", "My.Ns", "MyTests");
    expect(out).toContain("using Microsoft.VisualStudio.TestTools.UnitTesting;");
    expect(out).toContain("[TestClass]");
    expect(out).toContain("namespace My.Ns;");
    expect(out).toContain("public class MyTests");
  });

  it("emits NUnit attributes", () => {
    const out = getTestBoilerplate("nunit", "N", "C");
    expect(out).toContain("using NUnit.Framework;");
    expect(out).toContain("[Test]");
  });

  it("emits xUnit attributes (default branch)", () => {
    const out = getTestBoilerplate("xunit", "N", "C");
    expect(out).toContain("using Xunit;");
    expect(out).toContain("[Fact]");
  });
});

describe("tryParseDotNetFrameworkVersion", () => {
  it.each([
    ["net462", 462],
    ["net48", 480],
    ["NET472", 472],
    [" net46 ", 460],
  ])("parses classic framework %s → %i", (input, expected) => {
    expect(tryParseDotNetFrameworkVersion(input)).toBe(expected);
  });

  it.each(["net8.0", "netstandard2.0", "latest", ""])("returns undefined for %s", (input) => {
    expect(tryParseDotNetFrameworkVersion(input)).toBeUndefined();
  });
});

describe("isRunnableModernDotNetTargetFramework", () => {
  it("is true for SDK-style monikers", () => {
    expect(isRunnableModernDotNetTargetFramework("net8.0")).toBe(true);
    expect(isRunnableModernDotNetTargetFramework("NET6.0")).toBe(true);
  });

  it("is false for classic / netstandard", () => {
    expect(isRunnableModernDotNetTargetFramework("net472")).toBe(false);
    expect(isRunnableModernDotNetTargetFramework("netstandard2.0")).toBe(false);
  });
});

describe("resolveCompatibleTestTargetFramework", () => {
  it("bumps classic frameworks below 4.7.2 up to net472", () => {
    expect(resolveCompatibleTestTargetFramework("net462")).toBe("net472");
    expect(resolveCompatibleTestTargetFramework("net46")).toBe("net472");
  });

  it("keeps classic frameworks at or above 4.7.2", () => {
    expect(resolveCompatibleTestTargetFramework("net472")).toBe("net472");
    expect(resolveCompatibleTestTargetFramework("net48")).toBe("net48");
  });

  it("passes modern monikers through (normalized)", () => {
    expect(resolveCompatibleTestTargetFramework("net8.0")).toBe("net8.0");
    expect(resolveCompatibleTestTargetFramework("NET6.0")).toBe("net6.0");
  });

  it("maps netstandard to net8.0", () => {
    expect(resolveCompatibleTestTargetFramework("netstandard2.0")).toBe("net8.0");
  });

  it("returns the original input for unrecognized monikers", () => {
    expect(resolveCompatibleTestTargetFramework("weird")).toBe("weird");
  });
});

describe("tryParseCSharpLanguageVersion", () => {
  it.each([
    ["10", 100],
    ["7.3", 73],
    ["9.0", 90],
    ["11", 110],
  ])("parses %s → %i", (input, expected) => {
    expect(tryParseCSharpLanguageVersion(input)).toBe(expected);
  });

  it.each(["latest", "preview", "default", ""])("returns undefined for non-numeric %s", (input) => {
    expect(tryParseCSharpLanguageVersion(input)).toBeUndefined();
  });
});
