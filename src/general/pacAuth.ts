import * as cp from "child_process";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { parseConnectionString, normalizeOrganizationUrl } from "./connectionString";
import { pacInvocation } from "./pac";
import { parseAuthType, DataverseAuthType } from "./dataverse/authTypes";

// Shared pac authentication for every feature that shells out to `pac`
// (solutions, plugin modelbuilder). A single, clearly-named profile is
// (re)created from the connection string's service principal so we don't
// accumulate profiles, collide with the user's own, or silently run against
// whatever org their active profile happens to point at.
export const AUTH_PROFILE_NAME = "dataverse-powertools";

export interface ServicePrincipalAuth {
  profileName: string;
  applicationId: string;
  clientSecret: string;
  tenantId: string;
  environmentUrl: string;
}

/** `pac auth create` for a service principal targeting a specific environment. */
export function pacAuthCreateArgs(auth: ServicePrincipalAuth): string[] {
  return [
    "auth",
    "create",
    "--name",
    auth.profileName,
    "--applicationId",
    auth.applicationId,
    "--clientSecret",
    auth.clientSecret,
    "--tenant",
    auth.tenantId,
    "--environment",
    auth.environmentUrl,
  ];
}

/** `pac auth delete` by profile name (used to clear a stale profile before re-create). */
export function pacAuthDeleteArgs(profileName: string): string[] {
  return ["auth", "delete", "--name", profileName];
}

export interface PacResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run pac, never rejecting — the exit code is the result. On Windows pac is a
 * .cmd shim that execFile can't spawn directly (EINVAL); pac.ts routes it
 * through cmd.exe /c with an args array. */
export function runPacResult(args: string[], cwd: string): Promise<PacResult> {
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

export async function runPacLogged(context: DataversePowerToolsContext, args: string[], cwd: string, secret?: string): Promise<boolean> {
  const result = await runPacResult(args, cwd);
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
  await runPacResult(pacAuthDeleteArgs(AUTH_PROFILE_NAME), workspacePath);
  const created = await runPacLogged(context, pacAuthCreateArgs(auth), workspacePath, parts.clientSecret);
  if (!created) {
    context.channel.appendLine("pac auth create failed. See output for details.");
    vscode.window.showErrorMessage("Failed to authenticate with pac. See output for details.");
  }
  return created;
}

/**
 * Auth-type aware variant: service-principal connections (re)create the
 * extension's profile; interactive (OAuth) connections have no client secret to
 * hand pac, so the user's own active pac profile is used (logged so a wrong-org
 * profile is diagnosable). Never gate on tenantId alone — interactive
 * connections don't carry one (see CLAUDE.md, #90/#91).
 */
export async function ensurePacAuthForCurrentConnection(context: DataversePowerToolsContext, workspacePath: string): Promise<boolean> {
  const isOAuth = parseAuthType(parseConnectionString(context.connectionString).authType) === DataverseAuthType.oauth;
  if (isOAuth) {
    context.channel.appendLine(
      "Interactive (OAuth) connection: pac uses your active pac auth profile. If pac reports no authenticated profiles, run: pac auth create --environment <your org url>",
    );
    return true;
  }
  return ensurePacAuth(context, workspacePath);
}
