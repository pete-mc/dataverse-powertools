// Multi-targeting the plug-in project so its TESTS can run anywhere (#269).
//
// A Dataverse plug-in assembly must be .NET Framework — the sandbox loads net462 — but only the
// DEPLOYED assembly does. Until now the scaffolded projects were net4x-only, which meant the test
// project was net4x too, and `dotnet test` on net4x needs a .NET Framework test host: on Linux it
// builds and then aborts with "Could not find 'mono' host". That, not the replay harness, was the
// last Windows pin in the plug-in debugging journey (the harness uses only Convert.FromBase64String,
// DeflateStream, DataContractSerializer and Microsoft.Xrm.Sdk — all present on .NET 8).
//
// So the plug-in project multi-targets `net462;net8.0`: net462 is what ships, net8.0 is what the
// tests (and the replay harness, and the debugger via `coreclr`) run against.
//
// The `DvptDeployBuild` property collapses that back to net462 alone for the build+pack that
// produces the plug-in package. That matters: pack derives the nuspec's dependency groups from the
// RESTORE graph, so packing a project restored for both frameworks emits a stray
// `<group targetFramework="net8.0" />` and warns NU5128 — even with `-p:TargetFrameworks=net462`
// at pack time. Restoring net462-only is what makes the shipped package byte-shaped exactly like
// the old single-target one. Both the build and the pack in the deploy flow must pass it, or pack
// runs against a different graph than the build it is reusing via `--no-build`.
//
// All pure text/XML transforms — no vscode import, unit-tested directly.

/** The framework the DEPLOYED assembly must target: what the Dataverse sandbox loads. */
export const DEPLOY_TARGET_FRAMEWORK = "net462";

/** The modern framework the tests, replay harness and debugger run against. */
export const MODERN_TARGET_FRAMEWORK = "net8.0";

/** MSBuild property that collapses the project back to the deploy framework alone. */
export const DEPLOY_BUILD_PROPERTY = "DvptDeployBuild";

/** Pass to `dotnet build`/`dotnet pack` for the package that gets deployed. */
export const DEPLOY_BUILD_ARG = `-p:${DEPLOY_BUILD_PROPERTY}=true`;

/**
 * NuGet packages that only exist for .NET Framework, so they must not be referenced from the
 * modern target. `Microsoft.CrmSdk.*` is the Framework-only SDK (CoreAssemblies, Workflow,
 * CoreTools); `spkl` is the legacy deployment tool. The modern equivalent of Microsoft.Xrm.Sdk is
 * the netstandard2.0 assembly inside Microsoft.PowerPlatform.Dataverse.Client — the same package
 * the net8 typings tool already uses.
 */
const FRAMEWORK_ONLY_PACKAGE_PATTERN = /^(Microsoft\.CrmSdk\.|spkl$)/i;

/**
 * Packages that pin a TEST project to .NET Framework. A test project referencing one of these
 * cannot be moved to net8.0 no matter what the plug-in targets — `FakeXrmEasy.9` (the legacy
 * template-v2 test scaffold) ships net4x only, and `Microsoft.CrmSdk.*` never had a netstandard
 * build. So they are the signal to LEAVE AN EXISTING PROJECT ALONE: modernising it would trade a
 * working Windows test run for a broken one everywhere, which is a worse deal than staying put.
 */
const FRAMEWORK_PINNED_TEST_PACKAGE_PATTERN = /^(Microsoft\.CrmSdk\.|FakeXrmEasy\.9$|spkl$)/i;

/** The netstandard2.0 source of Microsoft.Xrm.Sdk for the modern target. */
export const MODERN_SDK_PACKAGE = "Microsoft.PowerPlatform.Dataverse.Client";
/**
 * FLOATING, not pinned — deliberately. DataverseUnitTest pulls this package in transitively and
 * raises its floor over time (3.4.0.54 wants >= 1.2.10). A hard pin below that floor is a package
 * DOWNGRADE, which NuGet reports as error NU1605, not a warning: `dotnet test` on the generated
 * replay project fails to restore at all. A floating patch keeps us at or above whatever the test
 * package needs. Matches the existing `9.0.2.*` convention in ensureReplayCsproj.
 */
export const MODERN_SDK_PACKAGE_VERSION = "1.2.*";

/** True for a classic .NET Framework moniker (`net462`, `net48`, `net471`). */
export function isFrameworkTargetFramework(targetFramework: string): boolean {
  return /^net\d{2,3}$/i.test(targetFramework.trim());
}

/** True for a modern SDK-style moniker (`net8.0`). */
export function isModernTargetFramework(targetFramework: string): boolean {
  return /^net\d+\.\d+$/i.test(targetFramework.trim());
}

/**
 * Every target framework a .csproj declares, from either `<TargetFramework>` or
 * `<TargetFrameworks>`. Conditioned overrides (the `DvptDeployBuild` one) are ignored — the
 * question this answers is "what can be built by default". Pure.
 */
export function parseTargetFrameworks(csprojXml: string): string[] {
  const plural = csprojXml.match(/<TargetFrameworks(?![a-zA-Z])(?![^>]*\bCondition=)[^>]*>([^<]+)<\/TargetFrameworks>/i);
  if (plural) {
    return plural[1]
      .split(";")
      .map((moniker) => moniker.trim())
      .filter((moniker) => moniker.length > 0);
  }
  const singular = csprojXml.match(/<TargetFramework(?![a-zA-Z])[^>]*>([^<]+)<\/TargetFramework>/i);
  return singular ? [singular[1].trim()] : [];
}

/** The modern moniker a project can be tested under, if it has one. Pure. */
export function modernTargetFrameworkOf(csprojXml: string): string | undefined {
  return parseTargetFrameworks(csprojXml).find(isModernTargetFramework);
}

/** True once `ensureMultiTargetedPluginCsproj` has been applied. Pure. */
export function isMultiTargetedForTests(csprojXml: string): boolean {
  const frameworks = parseTargetFrameworks(csprojXml);
  return frameworks.some(isFrameworkTargetFramework) && frameworks.some(isModernTargetFramework);
}

/** Every package id a .csproj references. Pure. */
export function referencedPackageIds(csprojXml: string): string[] {
  return Array.from(csprojXml.matchAll(/<PackageReference\b[^>]*?\b(?:Include|Update)\s*=\s*"([^"]+)"/gi)).map((match) => match[1]);
}

/**
 * True when a TEST project is pinned to .NET Framework by its own references, so it must not be
 * retargeted at net8.0 — see FRAMEWORK_PINNED_TEST_PACKAGE_PATTERN. Pure.
 */
export function isTestProjectPinnedToFramework(testCsprojXml: string): boolean {
  return referencedPackageIds(testCsprojXml).some((packageId) => FRAMEWORK_PINNED_TEST_PACKAGE_PATTERN.test(packageId));
}

/** Add `Condition` to a PackageReference tag, preserving any condition already there. Pure. */
function conditionPackageReference(tag: string, condition: string): string {
  if (/\bCondition\s*=/i.test(tag)) {
    return tag;
  }
  return tag.replace(/^<PackageReference/i, `<PackageReference Condition="${condition}"`);
}

/**
 * Make a single-target .NET Framework plug-in .csproj multi-target `net4xx;net8.0`, so the test
 * project can target net8.0 and actually run under `dotnet test` on any OS (#269). Idempotent:
 * a project that already carries a modern target is returned unchanged.
 *
 * Three edits, in order:
 * 1. `<TargetFramework>` → `<TargetFrameworks>net4xx;net8.0</TargetFrameworks>`, plus the
 *    `DvptDeployBuild` override that collapses it back for the packed build.
 * 2. Framework-only PackageReferences (Microsoft.CrmSdk.*, spkl) get a net4x-only Condition —
 *    without it, restore fails on net8.0.
 * 3. A net8.0-only ItemGroup supplying Microsoft.Xrm.Sdk from the netstandard2.0 client package.
 *    `PrivateAssets="All"` keeps it out of the dependency graph entirely.
 *
 * Pure.
 */
export function ensureMultiTargetedPluginCsproj(csprojXml: string): string {
  const frameworks = parseTargetFrameworks(csprojXml);
  const frameworkTarget = frameworks.find(isFrameworkTargetFramework);
  if (!frameworkTarget || frameworks.some(isModernTargetFramework)) {
    // Nothing to do: not a Framework project, or already multi-targeted.
    return csprojXml;
  }

  let out = csprojXml.replace(
    /<TargetFramework(?![a-zA-Z])([^>]*)>[^<]+<\/TargetFramework>/i,
    `<TargetFrameworks$1>${frameworkTarget};${MODERN_TARGET_FRAMEWORK}</TargetFrameworks>\n` +
      `    <!-- The DEPLOYED assembly is ${frameworkTarget} only; ${MODERN_TARGET_FRAMEWORK} exists so the tests, the\n` +
      `         replay harness and the debugger run on any OS (Dataverse PowerTools #269). -->\n` +
      `    <TargetFrameworks Condition="'$(${DEPLOY_BUILD_PROPERTY})'=='true'">${frameworkTarget}</TargetFrameworks>`,
  );

  const frameworkOnlyCondition = `'$(TargetFramework)'=='${frameworkTarget}'`;
  out = out.replace(/<PackageReference\b[^>]*?\/?>/gi, (tag) => {
    const packageId = tag.match(/\bInclude\s*=\s*"([^"]+)"/i)?.[1];
    if (!packageId || !FRAMEWORK_ONLY_PACKAGE_PATTERN.test(packageId)) {
      return tag;
    }
    return conditionPackageReference(tag, frameworkOnlyCondition);
  });

  if (!out.includes(MODERN_SDK_PACKAGE)) {
    const modernGroup =
      `  <ItemGroup Condition="'$(TargetFramework)'=='${MODERN_TARGET_FRAMEWORK}'">\n` +
      `    <!-- netstandard2.0 Microsoft.Xrm.Sdk, so the plug-in compiles for the test-only target.\n` +
      `         PrivateAssets keeps it out of the plug-in package's dependency graph. -->\n` +
      `    <PackageReference Include="${MODERN_SDK_PACKAGE}" Version="${MODERN_SDK_PACKAGE_VERSION}" PrivateAssets="All" />\n` +
      `  </ItemGroup>\n`;
    out = out.replace(/<\/Project>\s*$/, `${modernGroup}</Project>\n`);
  }

  return out;
}

/**
 * The framework a test project should target, given the plug-in project it references.
 *
 * A multi-targeted plug-in lets the tests be modern — which is the whole point of #269, since that
 * is the only way `dotnet test` runs without a .NET Framework test host. Otherwise fall back to the
 * plug-in's own framework (bumped to net472 when it is below DataverseUnitTest's minimum), which is
 * the pre-#269 behaviour and still the right answer for a project someone deliberately keeps
 * Framework-only. Pure.
 */
export function testTargetFrameworkForPlugin(pluginCsprojXml: string, fallback: (frameworkTarget: string) => string): string | undefined {
  const modern = modernTargetFrameworkOf(pluginCsprojXml);
  if (modern) {
    return modern;
  }
  const frameworks = parseTargetFrameworks(pluginCsprojXml);
  return frameworks.length > 0 ? fallback(frameworks[0]) : undefined;
}

/**
 * .NET namespaces that exist ONLY on .NET Framework, so a source file using one cannot compile for
 * the modern target. Custom workflow ACTIVITIES are the case that matters: they derive from
 * `System.Activities.CodeActivity` and use `Microsoft.Xrm.Sdk.Workflow`, neither of which has a
 * .NET build. Every scaffolded plug-in project contains `WorkflowBase.cs`, so without handling this
 * the whole project stopped compiling the moment it multi-targeted — a build failure that the e2e
 * log audit caught while the file-existence assertions above it still passed.
 */
const FRAMEWORK_ONLY_NAMESPACE_PATTERN = /^\s*using\s+(System\.Activities|Microsoft\.Xrm\.Sdk\.Workflow)\s*;/m;

/** The guard wrapped around Framework-only sources so they simply vanish from the modern target. */
const FRAMEWORK_GUARD_OPEN = "#if NETFRAMEWORK";
const FRAMEWORK_GUARD_CLOSE = "#endif";

/** True when a C# source can only compile for .NET Framework. Pure. */
export function isFrameworkOnlySource(source: string): boolean {
  return FRAMEWORK_ONLY_NAMESPACE_PATTERN.test(source);
}

/**
 * Wrap a Framework-only C# source in `#if NETFRAMEWORK` so a multi-targeted project still compiles
 * for the modern, test-only target — the file is simply empty there.
 *
 * `NETFRAMEWORK` is defined by the SDK for every net4x moniker and by nothing else, so this needs no
 * co-operation from the csproj. Excluding the file via `<Compile Remove>` instead would work only
 * for the filenames we happen to know at transform time; the guard travels with the file, so a
 * workflow class the user adds LATER from our template is already handled.
 *
 * Idempotent, and a no-op for sources that are not Framework-only. Pure.
 */
export function guardFrameworkOnlySource(source: string): string {
  if (!isFrameworkOnlySource(source) || source.includes(FRAMEWORK_GUARD_OPEN)) {
    return source;
  }
  const trimmedEnd = source.replace(/\s+$/, "");
  return (
    `${FRAMEWORK_GUARD_OPEN} // Custom workflow activities are .NET Framework only (System.Activities has no .NET build),\n` +
    `        // so they are excluded from the test-only target of a multi-targeted project (Dataverse PowerTools #269).\n` +
    `${trimmedEnd}\n${FRAMEWORK_GUARD_CLOSE}\n`
  );
}
