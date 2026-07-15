import * as cp from "child_process";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { parseConnectionString, normalizeOrganizationUrl } from "./connectionString";
import { pacInvocation } from "./pac";
import { parseAuthType, DataverseAuthType } from "./dataverse/authTypes";
import { beginPacOperation, setDeviceCodeSignIn, endPacOperation } from "../panel/pacActivityState";

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
  const ok = pacSucceeded(result);
  if (!ok) {
    context.channel.show();
  }
  return ok;
}

/**
 * (Re)create the pac auth profile from the current connection string's service
 * principal. Returns false (and reports why) if credentials are incomplete or the
 * profile can't be created.
 */
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_PATTERN = /^[0-9a-z.-]{1,100}$/i; // GUID or AAD domain
const ENVIRONMENT_URL_PATTERN = /^https:\/\/[0-9a-z][0-9a-z.-]*(:\d+)?\/?$/i;

export async function ensurePacAuth(context: DataversePowerToolsContext, workspacePath: string): Promise<boolean> {
  const parts = parseConnectionString(context.connectionString);
  const environmentUrl = normalizeOrganizationUrl(parts.url);
  const tenantId = context.projectSettings.tenantId || context.dataverse.tenantId || "";

  if (!parts.clientId || !parts.clientSecret || !tenantId || !environmentUrl) {
    context.channel.appendLine("Cannot authenticate with pac: connection string is missing client id, client secret, tenant, or URL. Update the connection string and retry.");
    vscode.window.showErrorMessage("Dataverse credentials are incomplete; cannot authenticate with pac.");
    return false;
  }

  // Shape-validate everything that reaches the pac command line (pac runs via
  // cmd.exe on Windows — the .cmd-shim trap): client id must be a GUID, tenant
  // a GUID/domain, the URL a plain https origin. Rejects malformed settings
  // before they can smuggle shell metacharacters.
  if (!GUID_PATTERN.test(parts.clientId) || !TENANT_PATTERN.test(tenantId) || !ENVIRONMENT_URL_PATTERN.test(environmentUrl)) {
    context.channel.appendLine("Cannot authenticate with pac: client id, tenant, or environment URL has an unexpected format. Update the connection string and retry.");
    vscode.window.showErrorMessage("Dataverse connection settings look malformed; cannot authenticate with pac.");
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
 * extension's profile from the client secret; interactive (OAuth) connections
 * have no secret to hand pac, so the extension establishes its OWN pac-owned,
 * clearly-named profile (`dataverse-powertools`) via pac's interactive
 * device-code sign-in (browser fallback) instead of borrowing whatever ambient
 * profile happens to be active — which could point at another tenant/user/org
 * (the root cause of #128/#129). Never gate on tenantId alone — interactive
 * connections don't carry one (see CLAUDE.md, #90/#91).
 */
export async function ensurePacAuthForCurrentConnection(context: DataversePowerToolsContext, workspacePath: string): Promise<boolean> {
  const parts = parseConnectionString(context.connectionString);
  const isOAuth = parseAuthType(parts.authType) === DataverseAuthType.oauth;
  if (!isOAuth) {
    return ensurePacAuth(context, workspacePath);
  }

  const environmentUrl = normalizeOrganizationUrl(parts.url);
  if (!environmentUrl || !ENVIRONMENT_URL_PATTERN.test(environmentUrl)) {
    context.channel.appendLine("The organisation URL looks malformed — cannot point pac at the project's environment.");
    vscode.window.showErrorMessage("pac authentication failed; see the Dataverse PowerTools output.");
    return false;
  }

  return ensureInteractivePacProfile(context, workspacePath, environmentUrl);
}

/** `pac org select` — point the ACTIVE auth profile at an environment. */
export function pacOrgSelectArgs(environmentUrl: string): string[] {
  return ["org", "select", "--environment", environmentUrl];
}

/** `pac auth create` for an INTERACTIVE (OAuth) sign-in targeting a specific
 * environment. `opts.deviceCode` switches pac to the device-code flow (a
 * code the user types at microsoft.com/devicelogin) instead of a browser popup —
 * the primary flow, with the browser variant as a fallback. */
export function pacAuthCreateInteractiveArgs(profileName: string, environmentUrl: string, opts?: { deviceCode?: boolean }): string[] {
  const args = ["auth", "create", "--name", profileName, "--environment", environmentUrl];
  if (opts?.deviceCode) {
    args.push("--deviceCode");
  }
  return args;
}

/** `pac auth select` — make a named profile the active one. */
export function pacAuthSelectArgs(profileName: string): string[] {
  return ["auth", "select", "--name", profileName];
}

/** `pac auth list`. */
export function pacAuthListArgs(): string[] {
  return ["auth", "list"];
}

/**
 * pac exits 0 even when it FAILS — `pac auth select`/`pac org select`/`pac modelbuilder`
 * all print "Error: …" to output while returning exit code 0 (confirmed against pac 2.8.1).
 * So a zero exit code is NOT proof of success: also scan the output for pac's error banner.
 * Without this the extension "reuses" a non-existent profile and reports early-bound
 * generation "complete" when it produced nothing (#128/#129).
 */
export function pacOutputHasError(text: string): boolean {
  return /(^|\n)\s*Error:/i.test(text || "");
}

/** True only when pac genuinely succeeded (exit 0 AND no error banner in its output). */
export function pacSucceeded(result: PacResult): boolean {
  return result.code === 0 && !pacOutputHasError(`${result.stdout}\n${result.stderr}`);
}

/** Whether the extension's named profile appears in `pac auth list` output. The list command
 * always exits 0 (even with no profiles), so parse the text, not the code. */
export function listHasNamedProfile(listOutput: string, profileName: string): boolean {
  const text = listOutput || "";
  if (/no profiles were found/i.test(text)) {
    return false;
  }
  return new RegExp(`(^|\\s)${profileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "m").test(text);
}

/** True when pac output signals an auth/identity failure (missing/expired/invalid
 * profile) that re-establishing the extension's profile could fix. Targeted on
 * purpose — a generic "file not found" or build error must NOT match, or the
 * self-healing runners would loop re-authenticating on unrelated failures. */
export function isPacAuthError(text: string): boolean {
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  const signatures = [
    "no profiles were found",
    "no active auth profile",
    "not authenticated",
    "no active environment",
    "reauthenticat", // reauthenticate / reauthentication
    "unauthor", // unauthorized / unauthorised
    "sign in again",
    "aadsts", // AAD sign-in error codes
  ];
  if (signatures.some((signature) => lower.includes(signature))) {
    return true;
  }
  if (lower.includes("token") && lower.includes("expired")) {
    return true;
  }
  if (/\b401\b/.test(lower)) {
    return true;
  }
  return false;
}

/** Parse pac's device-code prompt, e.g. "To sign in, use a web browser to open
 * the page https://microsoft.com/devicelogin and enter the code ABCD-EFGH to
 * authenticate." → { code, url }. Returns undefined when the text isn't a
 * device-code prompt. */
export function parseDeviceCode(text: string): { code: string; url: string } | undefined {
  if (!text) {
    return undefined;
  }
  const urlMatch = text.match(/open the page\s+(https?:\/\/[^\s]+)/i);
  const codeMatch = text.match(/enter the code\s+([A-Za-z0-9-]+)/i);
  if (urlMatch && codeMatch) {
    return { code: codeMatch[1], url: urlMatch[1] };
  }
  return undefined;
}

/** Run pac by STREAMING output as it arrives — needed for the device-code flow,
 * where the code must reach the user WHILE pac waits (execFile/runPacResult only
 * hand back a buffer at exit, too late). Appends every chunk to the channel live,
 * calls onChunk for stdout, and never rejects (the exit code is the result). Uses
 * pacInvocation so the Windows .cmd-shim trap is handled (see pac.ts). */
export function runPacStreaming(context: DataversePowerToolsContext, args: string[], cwd: string, onChunk?: (chunk: string) => void): Promise<PacResult> {
  const { command, args: invocationArgs } = pacInvocation(args);
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code: number) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ code, stdout, stderr });
    };
    const child = cp.spawn(command, invocationArgs, { cwd });
    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      context.channel.append(chunk);
      onChunk?.(chunk);
    });
    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      context.channel.append(chunk);
    });
    child.on("error", (error: Error) => {
      stderr += `${error.message}\n`;
      context.channel.appendLine(error.message);
      finish(1);
    });
    child.on("close", (code: number | null) => {
      finish(code ?? 0);
    });
  });
}

/**
 * Establish (or reuse) the extension's OWN interactive pac profile for the
 * project's environment. Reuse first — select the named profile and point it at
 * the environment; only recreate if that fails (mismatch / expiry). This is what
 * makes pac deterministic under OAuth: the extension owns a named identity
 * instead of borrowing the ambient-active one.
 */
export async function ensureInteractivePacProfile(context: DataversePowerToolsContext, workspacePath: string, environmentUrl: string): Promise<boolean> {
  // pac exits 0 even when the named profile doesn't exist (`pac auth select` prints
  // "Error: AuthProfileNameDoesNotExist" and still returns 0), so DON'T trust exit codes —
  // check `pac auth list` output for our profile. Trusting the code made the extension
  // "reuse" a profile that wasn't there and never sign in, so pac modelbuilder later failed
  // with "No profiles were found" (#128/#129).
  const list = await runPacResult(pacAuthListArgs(), workspacePath);
  if (listHasNamedProfile(`${list.stdout}\n${list.stderr}`, AUTH_PROFILE_NAME)) {
    const selected = await runPacResult(pacAuthSelectArgs(AUTH_PROFILE_NAME), workspacePath);
    const org = pacSucceeded(selected) ? await runPacResult(pacOrgSelectArgs(environmentUrl), workspacePath) : selected;
    if (pacSucceeded(selected) && pacSucceeded(org)) {
      context.channel.appendLine(`Reusing the '${AUTH_PROFILE_NAME}' pac profile for ${environmentUrl}.`);
      return true;
    }
    // The profile exists but can't target this environment (org mismatch or an expired
    // token) — fall through and recreate it from scratch.
    context.channel.appendLine(`The '${AUTH_PROFILE_NAME}' pac profile could not select ${environmentUrl} (mismatch or expiry) — re-establishing it.`);
  } else {
    context.channel.appendLine(`No '${AUTH_PROFILE_NAME}' pac profile found — establishing one for ${environmentUrl}.`);
  }
  return createInteractivePacProfile(context, workspacePath, environmentUrl);
}

/**
 * Create the extension's interactive pac profile via device code (browser
 * fallback). Deletes any stale same-named profile first, then runs the
 * device-code sign-in with live output so the code+URL can be surfaced to the
 * user the moment pac prints them. If device-code doesn't complete, falls back
 * to pac's browser sign-in.
 */
export async function createInteractivePacProfile(context: DataversePowerToolsContext, workspacePath: string, environmentUrl: string): Promise<boolean> {
  // Clear a stale profile of the same name (ignore the result — it may not exist).
  await runPacResult(pacAuthDeleteArgs(AUTH_PROFILE_NAME), workspacePath);

  // Surface the sign-in in the panel itself, not just a toast (which auto-dismisses) and the
  // output channel (not open by default). beginPacOperation shows a busy banner immediately;
  // once pac prints the device code, setDeviceCodeSignIn turns it into a prominent, actionable
  // card (copy code / open page). endPacOperation clears both, whatever the outcome.
  beginPacOperation(context, "Signing in to Power Platform CLI");
  context.channel.show();
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Signing in to pac (device code)…",
      },
      async () => {
        let promptedDeviceCode = false;
        const onChunk = (chunk: string) => {
          if (promptedDeviceCode) {
            return;
          }
          const device = parseDeviceCode(chunk);
          if (!device) {
            return;
          }
          promptedDeviceCode = true;
          // The persistent, hard-to-miss affordance: the panel card. Toast + channel stay as fallback.
          setDeviceCodeSignIn(context, { url: device.url, code: device.code });
          context.channel.appendLine("");
          context.channel.appendLine(`>>> To finish signing in to pac, open ${device.url} and enter the code ${device.code}`);
          void vscode.window.showInformationMessage(`To finish signing in, open ${device.url} and enter code ${device.code}`, "Open sign-in page").then((choice) => {
            if (choice === "Open sign-in page") {
              void vscode.env.openExternal(vscode.Uri.parse(device.url));
            }
          });
        };
        return runPacStreaming(context, pacAuthCreateInteractiveArgs(AUTH_PROFILE_NAME, environmentUrl, { deviceCode: true }), workspacePath, onChunk);
      },
    );

    if (pacSucceeded(result)) {
      context.channel.appendLine(`Created the '${AUTH_PROFILE_NAME}' pac profile for ${environmentUrl}.`);
      return true;
    }

    // Browser fallback: pac opens the system browser for an interactive sign-in.
    context.channel.appendLine("Device-code sign-in didn't complete — falling back to a browser sign-in.");
    const created = await runPacLogged(context, pacAuthCreateInteractiveArgs(AUTH_PROFILE_NAME, environmentUrl, { deviceCode: false }), workspacePath);
    if (!created) {
      vscode.window.showErrorMessage("Could not sign in to pac. See the Dataverse PowerTools output for details.");
    }
    return created;
  } finally {
    endPacOperation(context);
  }
}

/**
 * FORCE a fresh pac profile for the current connection, skipping any reuse. For
 * service principals this is ensurePacAuth (already delete+recreate); for OAuth
 * it recreates the interactive profile directly. Used by the self-healing runners
 * after an auth error.
 */
export async function reestablishPacAuthForCurrentConnection(context: DataversePowerToolsContext, workspacePath: string): Promise<boolean> {
  const parts = parseConnectionString(context.connectionString);
  if (parseAuthType(parts.authType) !== DataverseAuthType.oauth) {
    return ensurePacAuth(context, workspacePath);
  }
  const environmentUrl = normalizeOrganizationUrl(parts.url);
  if (!environmentUrl || !ENVIRONMENT_URL_PATTERN.test(environmentUrl)) {
    context.channel.appendLine("The organisation URL looks malformed — cannot point pac at the project's environment.");
    vscode.window.showErrorMessage("pac authentication failed; see the Dataverse PowerTools output.");
    return false;
  }
  return createInteractivePacProfile(context, workspacePath, environmentUrl);
}

/** Delete the extension's named pac profile (the "Clear pac credentials" command). */
export async function clearPacProfile(context: DataversePowerToolsContext, workspacePath: string): Promise<boolean> {
  const cleared = await runPacLogged(context, pacAuthDeleteArgs(AUTH_PROFILE_NAME), workspacePath);
  if (cleared) {
    context.channel.appendLine(`Cleared the '${AUTH_PROFILE_NAME}' pac profile.`);
  } else {
    context.channel.appendLine(`There was no '${AUTH_PROFILE_NAME}' pac profile to clear (or clearing it failed — see output).`);
  }
  return cleared;
}

/** Run a pac command, and if it fails with an AUTH error, re-establish the
 * extension's profile and retry ONCE. Non-auth failures are returned as-is. */
export async function runPacHealing(context: DataversePowerToolsContext, args: string[], workspacePath: string, _opts?: { secret?: string }): Promise<PacResult> {
  const first = await runPacResult(args, workspacePath);
  // pac exits 0 on failure, so gate on the OUTPUT (pacSucceeded), not the exit code.
  if (!pacSucceeded(first) && isPacAuthError(`${first.stdout}\n${first.stderr}`)) {
    context.channel.appendLine("[pac] Authentication error — re-establishing the pac profile and retrying once.");
    const reestablished = await reestablishPacAuthForCurrentConnection(context, workspacePath);
    if (reestablished) {
      return runPacResult(args, workspacePath);
    }
  }
  return first;
}

/** runPacLogged, but self-healing: retries once through runPacHealing after an
 * auth error. Redacts opts.secret and shows the channel on failure. */
export async function runPacLoggedHealing(context: DataversePowerToolsContext, args: string[], workspacePath: string, opts?: { secret?: string }): Promise<boolean> {
  const result = await runPacHealing(context, args, workspacePath, opts);
  if (result.stdout) {
    context.channel.appendLine(redact(result.stdout, opts?.secret));
  }
  if (result.stderr) {
    context.channel.appendLine(redact(result.stderr, opts?.secret));
  }
  const ok = pacSucceeded(result);
  if (!ok) {
    context.channel.show();
  }
  return ok;
}
