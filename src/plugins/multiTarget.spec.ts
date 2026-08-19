import { describe, it, expect } from "vitest";
import {
  DEPLOY_BUILD_ARG,
  DEPLOY_TARGET_FRAMEWORK,
  MODERN_SDK_PACKAGE,
  MODERN_TARGET_FRAMEWORK,
  ensureMultiTargetedPluginCsproj,
  isFrameworkTargetFramework,
  isModernTargetFramework,
  isMultiTargetedForTests,
  isTestProjectPinnedToFramework,
  modernTargetFrameworkOf,
  parseTargetFrameworks,
  referencedPackageIds,
  testTargetFrameworkForPlugin,
} from "./multiTarget";

// #269: the plug-in project multi-targets so its TESTS can run without a .NET Framework test host.
// The shipped assembly stays net462 — `DvptDeployBuild` collapses the project back for the packed
// build, which is what keeps the nuspec free of a stray net8.0 dependency group.

const PAC_GENERATED = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net462</TargetFramework>
    <SignAssembly>true</SignAssembly>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.CrmSdk.CoreAssemblies" Version="9.0.2.45" />
    <PackageReference Include="Microsoft.CrmSdk.Workflow" Version="9.0.2.45" PrivateAssets="All" />
  </ItemGroup>
</Project>
`;

describe("target framework parsing", () => {
  it("reads a single <TargetFramework>", () => {
    expect(parseTargetFrameworks(PAC_GENERATED)).toEqual(["net462"]);
  });

  it("reads and splits <TargetFrameworks>", () => {
    expect(parseTargetFrameworks("<TargetFrameworks>net462;net8.0</TargetFrameworks>")).toEqual(["net462", "net8.0"]);
  });

  it("ignores the conditioned deploy override, which is not a default target", () => {
    const csproj = ensureMultiTargetedPluginCsproj(PAC_GENERATED);
    expect(parseTargetFrameworks(csproj)).toEqual(["net462", "net8.0"]);
  });

  it("returns nothing for a csproj that declares no framework", () => {
    expect(parseTargetFrameworks("<Project></Project>")).toEqual([]);
  });

  it("classifies classic and modern monikers", () => {
    expect(isFrameworkTargetFramework("net462")).toBe(true);
    expect(isFrameworkTargetFramework("net48")).toBe(true);
    expect(isFrameworkTargetFramework("net8.0")).toBe(false);
    expect(isModernTargetFramework("net8.0")).toBe(true);
    expect(isModernTargetFramework("net462")).toBe(false);
  });
});

describe("ensureMultiTargetedPluginCsproj", () => {
  const multiTargeted = ensureMultiTargetedPluginCsproj(PAC_GENERATED);

  it("keeps the deploy framework and adds the modern one", () => {
    expect(multiTargeted).toContain(`<TargetFrameworks>${DEPLOY_TARGET_FRAMEWORK};${MODERN_TARGET_FRAMEWORK}</TargetFrameworks>`);
    expect(isMultiTargetedForTests(multiTargeted)).toBe(true);
    expect(modernTargetFrameworkOf(multiTargeted)).toBe(MODERN_TARGET_FRAMEWORK);
  });

  it("collapses back to the deploy framework alone under DvptDeployBuild", () => {
    expect(multiTargeted).toContain(`<TargetFrameworks Condition="'$(DvptDeployBuild)'=='true'">${DEPLOY_TARGET_FRAMEWORK}</TargetFrameworks>`);
    expect(DEPLOY_BUILD_ARG).toBe("-p:DvptDeployBuild=true");
  });

  it("conditions the Framework-only SDK packages so restore succeeds on the modern target", () => {
    expect(multiTargeted).toContain(`<PackageReference Condition="'$(TargetFramework)'=='net462'" Include="Microsoft.CrmSdk.CoreAssemblies"`);
    expect(multiTargeted).toContain(`<PackageReference Condition="'$(TargetFramework)'=='net462'" Include="Microsoft.CrmSdk.Workflow"`);
  });

  it("supplies Microsoft.Xrm.Sdk for the modern target without adding a package dependency", () => {
    expect(multiTargeted).toContain(`<ItemGroup Condition="'$(TargetFramework)'=='${MODERN_TARGET_FRAMEWORK}'">`);
    expect(multiTargeted).toMatch(new RegExp(`<PackageReference Include="${MODERN_SDK_PACKAGE.replace(/\./g, "\\.")}"[^>]*PrivateAssets="All"`));
  });

  it("leaves packages that exist on both frameworks unconditioned", () => {
    const withXunit = ensureMultiTargetedPluginCsproj(PAC_GENERATED.replace("</ItemGroup>", `  <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />\n  </ItemGroup>`));
    expect(withXunit).toContain('<PackageReference Include="Newtonsoft.Json" Version="13.0.3" />');
  });

  it("is idempotent — applying it twice changes nothing", () => {
    expect(ensureMultiTargetedPluginCsproj(multiTargeted)).toBe(multiTargeted);
  });

  it("leaves a project that is already modern alone", () => {
    const modern = `<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`;
    expect(ensureMultiTargetedPluginCsproj(modern)).toBe(modern);
  });

  it("preserves an existing Condition on a Framework-only package rather than stacking one", () => {
    const conditioned = PAC_GENERATED.replace(
      '<PackageReference Include="Microsoft.CrmSdk.CoreAssemblies" Version="9.0.2.45" />',
      `<PackageReference Condition="'$(Foo)'=='bar'" Include="Microsoft.CrmSdk.CoreAssemblies" Version="9.0.2.45" />`,
    );
    const out = ensureMultiTargetedPluginCsproj(conditioned);
    expect(out.match(/Condition=/g)?.length).toBe(
      // the untouched original condition, the DvptDeployBuild override, the Workflow package, and the modern ItemGroup
      4,
    );
  });
});

describe("testTargetFrameworkForPlugin", () => {
  const fallback = (frameworkTarget: string) => (frameworkTarget === "net462" ? "net472" : frameworkTarget);

  it("picks the modern target when the plug-in multi-targets — the point of #269", () => {
    expect(testTargetFrameworkForPlugin(ensureMultiTargetedPluginCsproj(PAC_GENERATED), fallback)).toBe(MODERN_TARGET_FRAMEWORK);
  });

  it("falls back to the pre-#269 behaviour for a deliberately Framework-only plug-in", () => {
    expect(testTargetFrameworkForPlugin(PAC_GENERATED, fallback)).toBe("net472");
  });

  it("returns nothing when the plug-in declares no framework at all", () => {
    expect(testTargetFrameworkForPlugin("<Project></Project>", fallback)).toBeUndefined();
  });
});

describe("isTestProjectPinnedToFramework", () => {
  it("flags the legacy template-v2 test scaffold, which has no netstandard build", () => {
    const legacy = `<Project><ItemGroup>
      <PackageReference Include="FakeXrmEasy.9" Version="1.58.1" />
      <PackageReference Include="Microsoft.CrmSdk.CoreAssemblies" Version="9.0.2.45" />
    </ItemGroup></Project>`;
    expect(isTestProjectPinnedToFramework(legacy)).toBe(true);
  });

  it("does not flag a modern test project", () => {
    const modern = `<Project><ItemGroup>
      <PackageReference Include="DataverseUnitTest" Version="3.4.0.54" />
      <PackageReference Include="xunit" Version="2.9.2" />
    </ItemGroup></Project>`;
    expect(isTestProjectPinnedToFramework(modern)).toBe(false);
  });

  it("reads Update= references too, not just Include=", () => {
    expect(referencedPackageIds(`<PackageReference Update="Microsoft.CrmSdk.Workflow" Version="9.0.2.45" />`)).toEqual(["Microsoft.CrmSdk.Workflow"]);
    expect(isTestProjectPinnedToFramework(`<PackageReference Update="Microsoft.CrmSdk.Workflow" Version="9.0.2.45" />`)).toBe(true);
  });

  it("does not confuse FakeXrmEasy.9 with an unrelated package that merely starts the same", () => {
    expect(isTestProjectPinnedToFramework(`<PackageReference Include="FakeXrmEasy.9.Abstractions" Version="2.0.0" />`)).toBe(false);
  });
});
