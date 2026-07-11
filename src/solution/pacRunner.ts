import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { parseConnectionString, normalizeOrganizationUrl } from "../general/connectionString";
import { runPacLogged, ensurePacAuth } from "../general/pacAuth";
import { parseSolutionConfig, SolutionConfig } from "./solutionConfig";

// pac auth handling (profile creation, logged runs) lives in ../general/pacAuth
// — shared with the plugin modelbuilder. Re-export for existing callers.
export { ensurePacAuth };

/** Read and parse spkl.json from the workspace root, reporting problems to the user. */
export async function loadSolutionConfig(context: DataversePowerToolsContext, workspacePath: string): Promise<SolutionConfig | undefined> {
  const spklPath = path.join(workspacePath, "spkl.json");
  if (!fs.existsSync(spklPath)) {
    context.channel.appendLine("No spkl.json found in the workspace root.");
    vscode.window.showErrorMessage("No spkl.json found; cannot determine the solution to operate on.");
    return undefined;
  }
  const raw = await fs.promises.readFile(spklPath, "utf8");
  const config = parseSolutionConfig(raw);
  if (!config) {
    context.channel.appendLine("spkl.json does not contain a usable solution entry (missing solution_uniquename?).");
    vscode.window.showErrorMessage("spkl.json has no usable solution entry.");
  }
  return config;
}

/** The organization URL derived from the current connection string. */
export function getEnvironmentUrl(context: DataversePowerToolsContext): string {
  return normalizeOrganizationUrl(parseConnectionString(context.connectionString).url);
}

/** Run a single pac solution command, logging output. Resolves to true on success. */
export async function runPacSolution(context: DataversePowerToolsContext, args: string[], workspacePath: string): Promise<boolean> {
  return runPacLogged(context, args, workspacePath);
}
