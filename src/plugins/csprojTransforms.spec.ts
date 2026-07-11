import { describe, it, expect } from "vitest";
import { addPrivateAssetsToWorkflowPackage, ensureReadmePackaging, defaultPluginReadme } from "./csprojTransforms";

const csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net462</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.CrmSdk.CoreAssemblies" Version="9.0.2.56" PrivateAssets="All" />
    <PackageReference Include="Microsoft.CrmSdk.Workflow" Version="9.0.2.56" />
  </ItemGroup>
</Project>`;

describe("addPrivateAssetsToWorkflowPackage", () => {
  it("adds PrivateAssets to the Workflow package only", () => {
    const result = addPrivateAssetsToWorkflowPackage(csproj);
    expect(result).toContain(`<PackageReference Include="Microsoft.CrmSdk.Workflow" Version="9.0.2.56" PrivateAssets="All" />`);
    expect(result.match(/PrivateAssets="All"/g)).toHaveLength(2);
  });

  it("is idempotent", () => {
    const once = addPrivateAssetsToWorkflowPackage(csproj);
    expect(addPrivateAssetsToWorkflowPackage(once)).toBe(once);
  });

  it("leaves csprojs without the package untouched", () => {
    const other = csproj.replace(/Microsoft\.CrmSdk\.Workflow/g, "Newtonsoft.Json");
    expect(addPrivateAssetsToWorkflowPackage(other)).toBe(other);
  });
});

describe("ensureReadmePackaging", () => {
  it("adds PackageReadmeFile and the packed None item", () => {
    const result = ensureReadmePackaging(csproj);
    expect(result).toContain("<PackageReadmeFile>README.md</PackageReadmeFile>");
    expect(result).toContain(`<None Include="README.md" Pack="true" PackagePath="\\" />`);
  });

  it("is idempotent", () => {
    const once = ensureReadmePackaging(csproj);
    expect(ensureReadmePackaging(once)).toBe(once);
  });
});

describe("defaultPluginReadme", () => {
  it("titles the readme with the project name", () => {
    expect(defaultPluginReadme("Contoso.Plugins")).toMatch(/^# Contoso\.Plugins/);
  });
});
