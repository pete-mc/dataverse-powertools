import { describe, expect, it } from "vitest";
import { extractProfileTypeName, extractTypeFromProfileFileName, replayTestSource, csprojWithProfilerRefs, replayClassName } from "./replayTest";

describe("extractProfileTypeName", () => {
  it("reads TypeName from a DataContract report, with or without a namespace prefix", () => {
    expect(extractProfileTypeName("<ProfilerPluginReport><TypeName>Contoso.AccountPlugin</TypeName></ProfilerPluginReport>")).toBe("Contoso.AccountPlugin");
    expect(extractProfileTypeName("<a:ProfilerPluginReport><a:TypeName>Contoso.X</a:TypeName></a:ProfilerPluginReport>")).toBe("Contoso.X");
    expect(extractProfileTypeName("<nothing/>")).toBeUndefined();
  });
});

describe("extractTypeFromProfileFileName", () => {
  it("recovers the type from a downloaded profile file name", () => {
    expect(extractTypeFromProfileFileName("Contoso.AccountPlugin_20260712-014500.profile.xml")).toBe("Contoso.AccountPlugin");
    expect(extractTypeFromProfileFileName("DvptProbe.ProbePlugin_20260712-153600.profile")).toBe("DvptProbe.ProbePlugin");
    expect(extractTypeFromProfileFileName("Contoso.X_unknown-time.profile")).toBe("Contoso.X");
  });

  it("returns undefined for names that aren't the download pattern", () => {
    expect(extractTypeFromProfileFileName("some-random-file.xml")).toBeUndefined();
    expect(extractTypeFromProfileFileName("profile.profile")).toBeUndefined();
    expect(extractTypeFromProfileFileName("Contoso.Plugin.profile")).toBeUndefined();
  });
});

describe("replayTestSource", () => {
  const options = {
    namespaceName: "MyPlugin_Tests",
    className: "Replay_AccountPlugin_20260712",
    pluginTypeName: "Contoso.AccountPlugin",
    pluginAssemblyFileName: "MyPlugin.dll",
    profileFileName: "Contoso.AccountPlugin_20260712-010203.profile.xml",
  };

  it("emits an mstest replay that calls ProfilerExecutionUtility.Replay", () => {
    const source = replayTestSource({ ...options, framework: "mstest" });
    expect(source).toContain("[TestClass]");
    expect(source).toContain("[TestMethod]");
    expect(source).toContain('new PluginOperationConfiguration(assemblyPath, "Contoso.AccountPlugin", profilePath, null)');
    expect(source).toContain("ProfilerExecutionUtility.Replay(");
    expect(source).toContain("PluginPermissions.NonIsolated");
    expect(source).toContain('FindProfile("Contoso.AccountPlugin_20260712-010203.profile.xml")');
    expect(source).toContain("Assert.IsNull(");
  });

  it("emits xunit and nunit variants with the right attributes", () => {
    const xunit = replayTestSource({ ...options, framework: "xunit" });
    expect(xunit).toContain("[Fact]");
    expect(xunit).toContain("using Xunit;");
    expect(xunit).not.toContain("[TestClass]");
    expect(xunit).toContain("Assert.Null(");
    const nunit = replayTestSource({ ...options, framework: "nunit" });
    expect(nunit).toContain("[TestFixture]");
    expect(nunit).toContain("[Test]");
  });
});

describe("csprojWithProfilerRefs", () => {
  const csproj = `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net462</TargetFramework>\n  </PropertyGroup>\n</Project>`;
  const assemblies = ["PluginProfiler.Library.dll", "PluginProfiler.Plugins.dll"];

  it("adds hint-path references before </Project>", () => {
    const patched = csprojWithProfilerRefs(csproj, assemblies, "..\\profiler-libs");
    expect(patched).toContain('<Reference Include="PluginProfiler.Library">');
    expect(patched).toContain("<HintPath>..\\profiler-libs\\PluginProfiler.Library.dll</HintPath>");
    expect(patched).toContain('<Reference Include="PluginProfiler.Plugins">');
    expect(patched.trim().endsWith("</Project>")).toBe(true);
  });

  it("copies the profiler DLLs (Private=true) but references Microsoft.Xrm.Sdk compile-only (Private=false)", () => {
    const patched = csprojWithProfilerRefs(csproj, [...assemblies, "Microsoft.Xrm.Sdk.dll"], "..\\profiler-libs");
    // Profiler libs are copy-local; Xrm.Sdk is compile-only (the test host gets it transitively, so
    // copying the profiler's copy too would raise version-conflict warnings).
    expect(patched).toMatch(/<Reference Include="PluginProfiler\.Library">[\s\S]*?<Private>true<\/Private>/);
    expect(patched).toMatch(/<Reference Include="Microsoft\.Xrm\.Sdk">[\s\S]*?<Private>false<\/Private>/);
  });

  it("is idempotent", () => {
    const once = csprojWithProfilerRefs(csproj, assemblies, "..\\profiler-libs");
    expect(csprojWithProfilerRefs(once, assemblies, "..\\profiler-libs")).toBe(once);
  });
});

describe("replayClassName", () => {
  it("uses the short type name and stamp", () => {
    expect(replayClassName("Contoso.Plugins.AccountPlugin", "20260712010203")).toBe("Replay_AccountPlugin_20260712010203");
  });
});
