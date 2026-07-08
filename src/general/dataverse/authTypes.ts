// Pure auth-type helpers for Dataverse authentication. No vscode / MSAL imports —
// keep it that way so the scope logic stays unit-testable. The actual token
// acquisition (MSAL loopback for interactive, the v1 endpoint for client secret)
// lives in tokenAcquisition and consumes these builders.

import { normalizeOrganizationUrl } from "../connectionString";

export enum DataverseAuthType {
  /** Service principal with a client secret (client-credentials grant). */
  clientSecret = "ClientSecret",
  /** Interactive user sign-in via MSAL's loopback flow. */
  oauth = "OAuth",
}

/**
 * Map a connection-string AuthType value (or any casing) to a known auth type.
 * Unknown / missing values fall back to ClientSecret, which is the historical
 * behaviour and keeps existing projects working.
 */
export function parseAuthType(value: string | undefined | null): DataverseAuthType {
  switch ((value ?? "").trim().toLowerCase()) {
    case "oauth":
    case "interactive":
      return DataverseAuthType.oauth;
    case "clientsecret":
    default:
      return DataverseAuthType.clientSecret;
  }
}

/**
 * The OAuth scope for the Dataverse Web API of a given org. `.default` requests
 * every permission already consented for the app/user on that resource, which is
 * what both the client-credentials and interactive flows want.
 */
export function buildDataverseScopes(organizationUrl: string | undefined | null): string[] {
  const base = normalizeOrganizationUrl(organizationUrl);
  return base ? [`${base}/.default`] : [];
}
