// Pure auth-type helpers for Dataverse authentication. No vscode / MSAL imports —
// keep it that way so the authority/scope logic stays unit-testable. The actual
// token acquisition (VS Code auth provider for interactive, MSAL for certificate)
// lives in dataverseContext and consumes these builders.

import { normalizeOrganizationUrl } from "../connectionString";

export enum DataverseAuthType {
  /** Service principal with a client secret (client-credentials grant). */
  clientSecret = "ClientSecret",
  /** Interactive user sign-in via VS Code's built-in Microsoft auth provider. */
  oauth = "OAuth",
  /** Service principal with a certificate (client-credentials grant). */
  certificate = "Certificate",
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
    case "certificate":
    case "cert":
      return DataverseAuthType.certificate;
    case "clientsecret":
    default:
      return DataverseAuthType.clientSecret;
  }
}

/** The Azure AD v1/v2 authority for a tenant (host + tenant, no trailing slash). */
export function buildAuthority(tenantId: string | undefined | null): string {
  const tenant = (tenantId ?? "").trim() || "common";
  return `https://login.microsoftonline.com/${tenant}`;
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

/** Whether an auth type needs a client secret / certificate (i.e. a confidential client). */
export function isConfidentialClient(authType: DataverseAuthType): boolean {
  return authType === DataverseAuthType.clientSecret || authType === DataverseAuthType.certificate;
}
