// Token acquisition for each Dataverse auth type. Isolated from dataverseContext
// so the (vscode / MSAL / network) I/O lives in one place; the pure authority /
// scope logic it relies on is in authTypes.ts and is unit-tested there.

import fetch from "node-fetch";
import * as vscode from "vscode";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { buildAuthority, buildDataverseScopes, buildInteractiveScopes } from "./authTypes";
import { CertificateCredential } from "./certificate";

export interface TokenResult {
  accessToken: string;
  /** When the token expires. VS Code-managed interactive tokens don't report this. */
  expiresOn: Date | null;
}

/**
 * Service principal + client secret via the v1 token endpoint (resource-style).
 * This is the original, working flow — kept byte-for-byte in behaviour.
 */
export async function acquireClientSecretToken(clientId: string, clientSecret: string, tenantId: string, organizationUrl: string): Promise<TokenResult | undefined> {
  const tokenUrl = "https://login.microsoftonline.com/" + tenantId + "/oauth2/token";
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  params.append("resource", organizationUrl);
  const response = await fetch(tokenUrl, {
    method: "post",
    body: params,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data: any = await response.json();
  if (data === null || data["access_token"] === undefined || data["access_token"] === null) {
    return undefined;
  }
  const expiresInSeconds = Number(data["expires_in"]) || 0;
  return { accessToken: data["access_token"], expiresOn: new Date(Date.now() + expiresInSeconds * 1000) };
}

/**
 * Service principal + certificate via MSAL (client-credentials grant). MSAL builds
 * and signs the client assertion from the private key + thumbprint for us.
 */
export async function acquireCertificateToken(clientId: string, tenantId: string, organizationUrl: string, credential: CertificateCredential): Promise<TokenResult | undefined> {
  const app = new ConfidentialClientApplication({
    auth: {
      clientId,
      authority: buildAuthority(tenantId),
      clientCertificate: {
        thumbprint: credential.thumbprint,
        privateKey: credential.privateKey,
      },
    },
  });
  const result = await app.acquireTokenByClientCredential({ scopes: buildDataverseScopes(organizationUrl) });
  if (!result || !result.accessToken) {
    return undefined;
  }
  return { accessToken: result.accessToken, expiresOn: result.expiresOn ?? null };
}

/**
 * Interactive user sign-in via VS Code's built-in Microsoft auth provider. VS Code
 * owns the browser flow, caching and silent refresh; pass promptIfNeeded on the
 * first connect (so the user is asked to sign in) and false afterwards (silent).
 */
export async function acquireInteractiveToken(organizationUrl: string, tenantId: string, clientId: string | undefined, promptIfNeeded: boolean): Promise<TokenResult | undefined> {
  const scopes = buildInteractiveScopes(organizationUrl, tenantId, clientId);
  if (scopes.length === 0) {
    return undefined;
  }
  const session = await vscode.authentication.getSession("microsoft", scopes, promptIfNeeded ? { createIfNone: true } : { createIfNone: false });
  if (!session || !session.accessToken) {
    return undefined;
  }
  // VS Code doesn't surface the expiry; treat as valid for ~50 minutes and then
  // re-request — getSession returns a cached/refreshed token silently.
  return { accessToken: session.accessToken, expiresOn: new Date(Date.now() + 50 * 60 * 1000) };
}
