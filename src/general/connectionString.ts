// Pure parsing/building helpers for Dataverse connection strings.
//
// A connection string looks like:
//   "AuthType=ClientSecret;LoginPrompt=Never;Url=https://org.crm.dynamics.com;ClientId=<guid>;ClientSecret=<secret>"
//
// Historically this codebase parsed these by splitting on ";" and indexing
// fixed positions (e.g. `split(";")[3]`), which breaks silently if the segment
// order changes, a segment is missing, or a value is empty. These helpers parse
// by name instead, case-insensitively and order-independently, and are covered
// by unit tests. No `vscode` import — keep it that way so it stays unit-testable.

export interface ParsedConnectionString {
  authType?: string;
  loginPrompt?: string;
  url?: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  /** Any keys we don't model explicitly, preserved under their lower-cased name. */
  [key: string]: string | undefined;
}

const CANONICAL_KEYS: Record<string, keyof ParsedConnectionString> = {
  authtype: "authType",
  loginprompt: "loginPrompt",
  url: "url",
  clientid: "clientId",
  clientsecret: "clientSecret",
  tenantid: "tenantId",
};

/** Emit order and display casing when reconstructing a connection string. */
const OUTPUT_LABELS: Array<[keyof ParsedConnectionString, string]> = [
  ["authType", "AuthType"],
  ["loginPrompt", "LoginPrompt"],
  ["url", "Url"],
  ["clientId", "ClientId"],
  ["clientSecret", "ClientSecret"],
  ["tenantId", "TenantID"],
];

/**
 * Parse a connection string into named parts. Unknown keys are preserved
 * (lower-cased). Empty/whitespace segments and segments without "=" are ignored.
 */
export function parseConnectionString(connectionString: string | undefined | null): ParsedConnectionString {
  const result: ParsedConnectionString = {};
  if (!connectionString) {
    return result;
  }

  for (const segment of connectionString.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const rawKey = trimmed.substring(0, eq).trim();
    const value = trimmed.substring(eq + 1).trim();
    if (!rawKey) {
      continue;
    }
    const canonical = CANONICAL_KEYS[rawKey.toLowerCase()] ?? rawKey.toLowerCase();
    result[canonical] = value;
  }

  return result;
}

/**
 * Normalize an organization URL: strip trailing slashes and coerce the scheme to
 * https. Dataverse is https-only, and its Azure AD resource principal is registered
 * under the https URL — an http or scheme-less url makes token requests fail with
 * AADSTS500011 ("resource principal ... not found in the tenant") because the
 * requested resource id doesn't match. So we always return an https url.
 */
export function normalizeOrganizationUrl(url: string | undefined | null): string {
  if (!url) {
    return "";
  }
  // Strip trailing slashes without a regex (avoids polynomial-backtracking / ReDoS).
  const trimmed = url.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed.charCodeAt(end - 1) === 47 /* "/" */) {
    end -= 1;
  }
  const stripped = trimmed.slice(0, end);
  if (!stripped) {
    return "";
  }
  const lower = stripped.toLowerCase();
  if (lower.startsWith("https://")) {
    return stripped;
  }
  if (lower.startsWith("http://")) {
    return "https://" + stripped.slice("http://".length);
  }
  return "https://" + stripped;
}

/** The organization URL from a connection string, trailing slashes removed. */
export function getOrganizationUrl(connectionString: string | undefined | null): string {
  return normalizeOrganizationUrl(parseConnectionString(connectionString).url);
}

/**
 * Reconstruct a connection string from parts, emitting only the parts that are
 * present, in a stable order.
 */
export function buildConnectionString(parts: ParsedConnectionString): string {
  const seen = new Set<string>();
  const segments: string[] = [];

  for (const [key, label] of OUTPUT_LABELS) {
    const value = parts[key];
    if (value !== undefined && value !== "") {
      segments.push(`${label}=${value}`);
    }
    seen.add(key as string);
  }

  for (const [key, value] of Object.entries(parts)) {
    if (seen.has(key) || value === undefined || value === "") {
      continue;
    }
    segments.push(`${key}=${value}`);
  }

  return segments.join(";");
}

/**
 * Merge a persisted base connection string (AuthType/LoginPrompt/Url — secrets kept
 * out of the settings file) with a `ClientId=…;ClientSecret=…` credential string from
 * secret storage. Uses the parser/builder so separators are always correct: a plain
 * string concat glued `Url=<url>` and `ClientId=…` together when the base had no
 * trailing `;`, producing an invalid string that broke auth + typings on every reload.
 */
export function mergeCredentialConnectionString(base: string | undefined | null, credentialString: string | undefined | null): string {
  const baseParts = parseConnectionString(base);
  const creds = parseConnectionString(credentialString);
  return buildConnectionString({ ...baseParts, clientId: creds.clientId, clientSecret: creds.clientSecret });
}

/**
 * Build the connection string for a chosen auth type, emitting only the parts that
 * type needs: ClientSecret keeps its secret + LoginPrompt; OAuth carries nothing
 * sensitive. Empty parts are dropped by buildConnectionString.
 */
export function buildAuthConnectionString(params: { authType: string; url: string; clientId?: string; clientSecret?: string }): string {
  return buildConnectionString({
    authType: params.authType,
    loginPrompt: params.authType === "ClientSecret" ? "Never" : undefined,
    url: params.url,
    clientId: params.clientId,
    clientSecret: params.clientSecret,
  });
}
