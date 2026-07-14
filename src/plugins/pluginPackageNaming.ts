// Pure plugin-package naming (#134). Deterministic PackageId / unique-name derivation, kept
// vscode-free and unit-tested so the package is named the same way every run regardless of
// which input varies (prefix, configured package name, or csproj file name) — the
// "Plugin.1.0.0 vs dvpt_Plugin.1.0.0" inconsistency came from these rules living inline and
// only being applied on some code paths.

/** Normalise a customization prefix to a pac-safe leading segment; defaults to `dpt`. */
export function normalizeCustomizationPrefix(prefix: string | undefined): string {
  // `[^A-Za-z0-9]` already removes underscores, so no separate trailing-underscore trim is needed.
  const sanitized = (prefix || "").trim().replace(/[^A-Za-z0-9]/g, "");
  if (!sanitized) {
    return "dpt";
  }
  if (!/^[A-Za-z]/.test(sanitized)) {
    return `p${sanitized}`;
  }
  return sanitized;
}

/** Sanitise a single unique-name segment (letters, digits, single underscores). */
export function sanitizeUniqueNameSegment(value: string): string {
  return value
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_") // collapse runs first, so the trims below only ever see a single underscore (avoids polynomial backtracking)
    .replace(/^_/, "")
    .replace(/_$/, "");
}

/**
 * The PackageId passed to `dotnet pack -p:PackageId=...`, which also names the produced
 * `<id>.<version>.nupkg`. Always prefixed, so Build and Build & Deploy agree.
 */
export function prefixedPackageId(prefix: string | undefined, pluginPackageName: string | undefined, csprojBaseName: string): string {
  const normalizedPrefix = normalizeCustomizationPrefix(prefix);
  const configuredName = sanitizeUniqueNameSegment(pluginPackageName || "");
  const projectName = configuredName || sanitizeUniqueNameSegment(csprojBaseName) || "Plugin";
  return `${normalizedPrefix}_${projectName}`;
}

/** The Dataverse pluginpackage unique name for a packed package's base name. */
export function pluginPackageUniqueName(prefix: string | undefined, packageName: string): string {
  const normalizedPrefix = normalizeCustomizationPrefix(prefix);
  const segment = sanitizeUniqueNameSegment(packageName);
  const baseSegment = segment.length > 0 ? segment : "pluginpackage";

  // An already-prefixed name (`<letters>_...`) is left as-is; otherwise prepend the prefix.
  let uniqueName = /^[A-Za-z][A-Za-z0-9]*_/.test(baseSegment) ? baseSegment : `${normalizedPrefix}_${baseSegment}`;
  if (uniqueName.length > 128) {
    uniqueName = uniqueName.substring(0, 128);
  }
  return uniqueName;
}
