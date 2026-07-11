// Pure builders for `pac` CLI argument arrays. No `vscode` import — keep it
// unit-testable, and keep the exact flags visible in one place so they're easy to
// verify against the pac reference (https://learn.microsoft.com/power-platform/developer/cli/reference).
import { SolutionConfig, managedZipPath, PackageType } from "./solutionConfig";

// Auth builders moved to ../general/pacAuth (shared with plugin modelbuilder);
// re-exported so existing imports and the spec keep working.
export type { ServicePrincipalAuth } from "../general/pacAuth";
export { pacAuthCreateArgs, pacAuthDeleteArgs } from "../general/pacAuth";

/** `pac solution pack` — local folder -> solution .zip. No auth required. */
export function pacSolutionPackArgs(config: SolutionConfig, managed = false): string[] {
  // When packing from a "Both" folder, pac still produces one type at a time.
  const packageType: PackageType = config.packageType === "Both" ? (managed ? "Managed" : "Unmanaged") : config.packageType;
  const zip = managed ? managedZipPath(config.zipPath) : config.zipPath;
  return ["solution", "pack", "--zipfile", zip, "--folder", config.packagePath, "--packagetype", packageType];
}

/** `pac solution unpack` — solution .zip -> local folder. No auth required. */
export function pacSolutionUnpackArgs(config: SolutionConfig): string[] {
  return ["solution", "unpack", "--zipfile", config.zipPath, "--folder", config.packagePath, "--packagetype", config.packageType, "--allowDelete"];
}

export interface ExportOptions {
  managed: boolean;
  environmentUrl: string;
  /** Override the output zip path (e.g. the `_managed.zip` sibling for a "Both" export). Defaults to config.zipPath. */
  zipPath?: string;
}

/** `pac solution export` — pull a solution .zip from Dataverse. Requires an active auth profile. */
export function pacSolutionExportArgs(config: SolutionConfig, options: ExportOptions): string[] {
  const zip = options.zipPath ?? config.zipPath;
  return [
    "solution",
    "export",
    "--path",
    zip,
    "--name",
    config.uniqueName,
    "--managed",
    options.managed ? "true" : "false",
    "--overwrite",
    "true",
    "--environment",
    options.environmentUrl,
  ];
}

/** `pac solution import` — push a solution .zip into Dataverse. Requires an active auth profile. */
export function pacSolutionImportArgs(config: SolutionConfig, environmentUrl: string): string[] {
  return ["solution", "import", "--path", config.zipPath, "--environment", environmentUrl, "--publish-changes", "true"];
}
