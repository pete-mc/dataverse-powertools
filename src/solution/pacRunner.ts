import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import DataversePowerToolsContext from "../context";
import { parseConnectionString, normalizeOrganizationUrl } from "../general/connectionString";
import { pacInvocation } from "../general/pac";
import { pacAuthCreateArgs, pacAuthDeleteArgs, ServicePrincipalAuth } from "./pacArgs";
import { parseSolutionConfig, SolutionConfig } from "./solutionConfig";

// A single, clearly-named pac auth profile is (re)created for the extension so we
// don't accumulate profiles or collide with the user's own. spkl took the
// connection string inline; pac authenticates via stored profiles instead.
const AUTH_PROFILE_NAME = "dataverse-powertools";

interface PacResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runPac(args: string[], cwd: string): Promise<PacResult> {
  // On Windows pac is a .cmd shim that execFile can't spawn directly (EINVAL); pac.ts
  // routes it through cmd.exe /c with an args array.
  const { command, args: invocationArgs } = pacInvocation(args);
  return new Promise((resolve) => {
    cp.execFile(command, invocationArgs, { cwd, maxBuffer: 1024 * 1024 * 10 }, (error: any, stdout: string, stderr: string) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

function redact(text: string, secret?: string): string {
  if (!secret || secret.length === 0) {
    return text;
  }
  return text.split(secret).join("***");
}

async function runPacLogged(context: DataversePowerToolsContext, args: string[], cwd: string, secret?: string): Promise<boolean> {
  const result = await runPac(args, cwd);
  if (result.stdout) {
    context.channel.appendLine(redact(result.stdout, secret));
  }
  if (result.stderr) {
    context.channel.appendLine(redact(result.stderr, secret));
  }
  if (result.code !== 0) {
    context.channel.show();
  }
  return result.code === 0;
}

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

/**
 * (Re)create the pac auth profile from the current connection string's service
 * principal. Returns false (and reports why) if credentials are incomplete or the
 * profile can't be created.
 */
export async function ensurePacAuth(context: DataversePowerToolsContext, workspacePath: string): Promise<boolean> {
  const parts = parseConnectionString(context.connectionString);
  const environmentUrl = normalizeOrganizationUrl(parts.url);
  const tenantId = context.projectSettings.tenantId || context.dataverse.tenantId || "";

  if (!parts.clientId || !parts.clientSecret || !tenantId || !environmentUrl) {
    context.channel.appendLine("Cannot authenticate with pac: connection string is missing client id, client secret, tenant, or URL. Update the connection string and retry.");
    vscode.window.showErrorMessage("Dataverse credentials are incomplete; cannot authenticate with pac.");
    return false;
  }

  const auth: ServicePrincipalAuth = {
    profileName: AUTH_PROFILE_NAME,
    applicationId: parts.clientId,
    clientSecret: parts.clientSecret,
    tenantId,
    environmentUrl,
  };

  // Clear any stale profile of the same name (ignore failure — it may not exist),
  // then create a fresh one so credentials are always current.
  await runPac(pacAuthDeleteArgs(AUTH_PROFILE_NAME), workspacePath);
  const created = await runPacLogged(context, pacAuthCreateArgs(auth), workspacePath, parts.clientSecret);
  if (!created) {
    context.channel.appendLine("pac auth create failed. See output for details.");
    vscode.window.showErrorMessage("Failed to authenticate with pac. See output for details.");
  }
  return created;
}

/** Run a single pac solution command, logging output. Resolves to true on success. */
export async function runPacSolution(context: DataversePowerToolsContext, args: string[], workspacePath: string): Promise<boolean> {
  return runPacLogged(context, args, workspacePath);
}
