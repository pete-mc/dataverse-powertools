import { describe, expect, it } from "vitest";
import { extractProfileTypeName, extractTypeFromProfileFileName, replayTestSource, replayHarnessSource, ensureReplayCsproj, replayClassName } from "./replayTest";

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
    profileFileName: "Contoso.AccountPlugin_20260712-010203.profile.xml",
  };

  it("emits an mstest replay that invokes the plugin in-process via the DvptReplay harness", () => {
    const source = replayTestSource({ ...options, framework: "mstest" });
    expect(source).toContain("[TestClass]");
    expect(source).toContain("[TestMethod]");
    expect(source).toContain("using DvptReplay;");
    expect(source).toContain('ProfileReplay.LoadContext(ProfileReplay.FindProfile("Contoso.AccountPlugin_20260712-010203.profile.xml"))');
    expect(source).toContain("var plugin = new Contoso.AccountPlugin(null, null);");
    expect(source).toContain("plugin.Execute(ProfileReplay.CreateServiceProvider(context));");
    // No PRT / AppDomain approach anymore.
    expect(source).not.toContain("ProfilerExecutionUtility");
    expect(source).not.toContain("PluginOperationConfiguration");
  });

  it("emits xunit and nunit variants with the right attributes", () => {
    const xunit = replayTestSource({ ...options, framework: "xunit" });
    expect(xunit).toContain("[Fact]");
    expect(xunit).toContain("using Xunit;");
    expect(xunit).not.toContain("[TestClass]");
    const nunit = replayTestSource({ ...options, framework: "nunit" });
    expect(nunit).toContain("[TestFixture]");
    expect(nunit).toContain("[Test]");
  });
});

describe("replayHarnessSource", () => {
  const harness = replayHarnessSource();
  it("is a self-contained, Xrm.Sdk-only harness (no PluginProfiler assemblies)", () => {
    expect(harness).toContain("namespace DvptReplay");
    expect(harness).toContain("class CapturedPluginContext : IPluginExecutionContext");
    expect(harness).toContain("public static IPluginExecutionContext LoadContext(string profilePath)");
    expect(harness).toContain("DeflateStream"); // base64 → raw-DEFLATE decode
    expect(harness).toContain("DataContractSerializer(typeof(object), new[] { typeof(CapturedPluginContext) })");
    expect(harness).toContain("using Microsoft.Xrm.Sdk;");
    expect(harness).not.toContain("PluginProfiler");
  });
  it("RequestId is nullable to satisfy IExecutionContext", () => {
    expect(harness).toContain("public Guid? RequestId { get; set; }");
  });
});

describe("ensureReplayCsproj", () => {
  const csproj = `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net472</TargetFramework>\n  </PropertyGroup>\n</Project>`;

  it("adds a Microsoft.Xrm.Sdk (CoreAssemblies) reference + binding redirects", () => {
    const patched = ensureReplayCsproj(csproj);
    expect(patched).toContain('<PackageReference Include="Microsoft.CrmSdk.CoreAssemblies"');
    expect(patched).toContain("<AutoGenerateBindingRedirects>true</AutoGenerateBindingRedirects>");
    expect(patched.trim().endsWith("</Project>")).toBe(true);
  });

  it("is idempotent", () => {
    const once = ensureReplayCsproj(csproj);
    expect(ensureReplayCsproj(once)).toBe(once);
  });
});

describe("replayClassName", () => {
  it("uses the short type name and stamp", () => {
    expect(replayClassName("Contoso.Plugins.AccountPlugin", "20260712010203")).toBe("Replay_AccountPlugin_20260712010203");
  });
});
