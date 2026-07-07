// Pure helpers for reading the (legacy) spkl.json solution config and mapping it
// to the values pac needs. No `vscode` import — keep it unit-testable.
//
// spkl.json shape (only the fields we use):
//   { "solutions": [ { "solution_uniquename": "...", "packagepath": "...",
//                      "packagetype": "both_unmanaged_import" } ] }

export type PackageType = "Unmanaged" | "Managed" | "Both";

export interface SolutionConfig {
  /** Unique name of the solution in Dataverse. */
  uniqueName: string;
  /** Source folder that the solution is unpacked into / packed from. */
  packagePath: string;
  /** Local path of the packed solution .zip. */
  zipPath: string;
  /** Managed/Unmanaged/Both, translated from spkl's packagetype. */
  packageType: PackageType;
}

/**
 * Translate spkl's packagetype string to SolutionPackager's package type.
 * spkl uses values like "both_unmanaged_import", "managed", "unmanaged".
 */
export function mapSpklPackageType(spklType: string | undefined): PackageType {
  const t = (spklType ?? "").toLowerCase();
  if (t.includes("both")) {
    return "Both";
  }
  if (t.includes("unmanaged")) {
    return "Unmanaged";
  }
  if (t.includes("managed")) {
    return "Managed";
  }
  return "Unmanaged";
}

/** Insert a `_managed` suffix before the .zip extension (SolutionPackager convention). */
export function managedZipPath(zipPath: string): string {
  return zipPath.replace(/\.zip$/i, "_managed.zip");
}

/**
 * Parse spkl.json into a SolutionConfig, or undefined if there is no usable
 * solution entry. Uses the first solution entry (matching spkl's behaviour) and
 * a stable `bin/<uniquename>.zip` package location (spkl's versioned solutionpath
 * pattern isn't meaningful to pac).
 */
export function parseSolutionConfig(spklJson: string): SolutionConfig | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(spklJson);
  } catch {
    return undefined;
  }

  const solutions = (parsed as { solutions?: unknown })?.solutions;
  const first = Array.isArray(solutions) ? (solutions[0] as Record<string, unknown> | undefined) : undefined;
  const uniqueName = typeof first?.solution_uniquename === "string" ? first.solution_uniquename.trim() : "";
  if (!uniqueName) {
    return undefined;
  }

  const packagePath = typeof first?.packagepath === "string" && first.packagepath.trim() !== "" ? first.packagepath.trim() : uniqueName;

  return {
    uniqueName,
    packagePath,
    zipPath: `bin/${uniqueName}.zip`,
    packageType: mapSpklPackageType(typeof first?.packagetype === "string" ? first.packagetype : undefined),
  };
}
