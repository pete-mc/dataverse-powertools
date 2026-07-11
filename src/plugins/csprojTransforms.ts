// Pure text transforms applied to the pac-generated plugin .csproj during
// normalizePluginV3Layout. No vscode import — unit-tested directly.

/** Mark Microsoft.CrmSdk.Workflow as PrivateAssets="All" so it is compiled
 * against but never flows into the plugin NuGet package as a dependency
 * (`dotnet add package` can't set this, so it's patched post-init). */
export function addPrivateAssetsToWorkflowPackage(csproj: string): string {
  return csproj.replace(/<PackageReference(\s[^>]*Include="Microsoft\.CrmSdk\.Workflow"[^>]*?)(\s*\/>|\s*>)/g, (match, attrs: string, close: string) => {
    if (/PrivateAssets\s*=/i.test(attrs)) {
      return match;
    }
    return `<PackageReference${attrs} PrivateAssets="All"${close}`;
  });
}

/** Wire a README.md into the NuGet package so `dotnet pack` stops warning that
 * the plugin package has no readme. Idempotent. */
export function ensureReadmePackaging(csproj: string, readmeFileName: string = "README.md"): string {
  let result = csproj;
  if (!result.includes("<PackageReadmeFile>")) {
    result = result.replace(/(<PropertyGroup[^>]*>)/, `$1\n    <PackageReadmeFile>${readmeFileName}</PackageReadmeFile>`);
  }
  if (!new RegExp(`<None[^>]*Include="${readmeFileName}"`).test(result)) {
    result = result.replace(/(<\/Project>)/, `  <ItemGroup>\n    <None Include="${readmeFileName}" Pack="true" PackagePath="\\" />\n  </ItemGroup>\n$1`);
  }
  return result;
}

/** Default README content packed into a new plugin project's NuGet package. */
export function defaultPluginReadme(projectName: string): string {
  return [
    `# ${projectName}`,
    "",
    "Dataverse plugin package created with [Dataverse PowerTools](https://marketplace.visualstudio.com/items?itemName=dataversepowertools.dataverse-powertools).",
    "",
    "- Plugin classes register their steps with `[CrmPluginRegistration]` decorations — use the CodeLens in each class to add or update them.",
    "- Build & deploy from the Dataverse PowerTools panel in VS Code.",
    "",
  ].join("\n");
}
