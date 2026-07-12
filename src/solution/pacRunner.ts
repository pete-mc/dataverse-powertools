import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { parseConnectionString, normalizeOrganizationUrl } from "../general/connectionString";
import { runPacLogged, ensurePacAuth, ensurePacAuthForCurrentConnection } from "../general/pacAuth";
import { parseSolutionConfig, SolutionConfig } from "./solutionConfig";

// pac auth handling (profile creation, logged runs) lives in ../general/pacAuth
// — shared with the plugin modelbuilder. Re-export for existing callers.
// Solution flows use the auth-type-aware variant so OAuth works (user report:
// extract failed under OAuth — ensurePacAuth is service-principal-only).
export { ensurePacAuth, ensurePacAuthForCurrentConnection };

/** The solution pack/unpack config. Lives in dataverse-powertools.json
 * (settings.solutionConfig); a legacy spkl.json is migrated into settings on
 * first read (user feedback: one config file, not two). */
export async function loadSolutionConfig(context: DataversePowerToolsContext, workspacePath: string): Promise<SolutionConfig | undefined> {
  const fromSettings = context.projectSettings.solutionConfig;
  if (fromSettings?.uniqueName) {
    return fromSettings as SolutionConfig;
  }

  const spklPath = path.join(workspacePath, "spkl.json");
  if (fs.existsSync(spklPath)) {
    const raw = await fs.promises.readFile(spklPath, "utf8");
    const config = parseSolutionConfig(raw);
    if (config) {
      context.projectSettings.solutionConfig = config;
      await context.writeSettings();
      context.channel.appendLine("Migrated the solution configuration from spkl.json into dataverse-powertools.json (spkl.json is no longer read).");
      return config;
    }
    context.channel.appendLine("spkl.json does not contain a usable solution entry (missing solution_uniquename?).");
  }

  // Sensible defaults from the connected solution when nothing is configured.
  const uniqueName = context.projectSettings.solutionName;
  if (uniqueName) {
    const config: SolutionConfig = { uniqueName, packagePath: path.join("src", uniqueName), zipPath: path.join("bin", `${uniqueName}.zip`), packageType: "Both" };
    context.projectSettings.solutionConfig = config;
    await context.writeSettings();
    context.channel.appendLine(`No solution configuration found — defaulted to solution '${uniqueName}' (src/${uniqueName} ↔ bin/${uniqueName}.zip, Both).`);
    return config;
  }

  vscode.window.showErrorMessage("No solution is configured (settings.solutionConfig) and no solutionName is set.");
  return undefined;
}

/** The organization URL derived from the current connection string. */
export function getEnvironmentUrl(context: DataversePowerToolsContext): string {
  return normalizeOrganizationUrl(parseConnectionString(context.connectionString).url);
}

/** Run a single pac solution command, logging output. Resolves to true on success. */
export async function runPacSolution(context: DataversePowerToolsContext, args: string[], workspacePath: string): Promise<boolean> {
  return runPacLogged(context, args, workspacePath);
}
