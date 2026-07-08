// Token acquisition for each Dataverse auth type. Isolated from dataverseContext
// so the (vscode / MSAL / network) I/O lives in one place; the pure authority /
// scope logic it relies on is in authTypes.ts and is unit-tested there.

import fetch from "node-fetch";
import * as vscode from "vscode";
import { PublicClientApplication, AccountInfo, ICachePlugin, TokenCacheContext } from "@azure/msal-node";
import { buildDataverseScopes } from "./authTypes";
import { SIGN_IN_SUCCESS_HTML, SIGN_IN_ERROR_HTML } from "./authPages";

export interface TokenResult {
  accessToken: string;
  /** When the token expires, if known. */
  expiresOn: Date | null;
}

/**
 * Microsoft's well-known sample application, the same one Dataverse tooling such as
 * XrmToolBox uses for interactive sign-in. It has http://localhost registered (for
 * the MSAL loopback flow) and the Dataverse delegated permission, so users don't have
 * to register their own app. A project can override it by putting its own ClientId in
 * the connection. If Microsoft ever restricts this app, override with a project app id.
 */
export const DEFAULT_INTERACTIVE_CLIENT_ID = "51f81489-12ee-4a9e-aaae-a2591f45987d";

/**
 * Interactive uses the multi-tenant "organizations" authority (not a specific
 * tenant) so a single signed-in account is reused across the Global Discovery call
 * and the per-environment token — the user signs in once. MSAL resolves the account's
 * own tenant when issuing tokens.
 */
export const INTERACTIVE_AUTHORITY = "https://login.microsoftonline.com/organizations";

interface InteractiveApp {
  pca: PublicClientApplication;
  account?: AccountInfo;
}

// Cache one MSAL public-client app per authority+clientId so its in-memory token
// cache (and refresh token) survives across acquireToken calls — otherwise every
// renewal would reopen the browser.
const interactiveApps = new Map<string, InteractiveApp>();

// Persist MSAL's token cache to VS Code secret storage so the refresh token survives
// a window reload / restart — otherwise the user would have to sign in again every
// time VS Code restarts. Set once at activation via initInteractiveTokenCache.
const MSAL_CACHE_SECRET_KEY = "dataverse-powertools.msal-cache";
let cacheSecrets: vscode.SecretStorage | undefined;

export function initInteractiveTokenCache(secrets: vscode.SecretStorage): void {
  cacheSecrets = secrets;
}

const cachePlugin: ICachePlugin = {
  beforeCacheAccess: async (cacheContext: TokenCacheContext) => {
    if (!cacheSecrets) {
      return;
    }
    const cached = await cacheSecrets.get(MSAL_CACHE_SECRET_KEY);
    if (cached) {
      cacheContext.tokenCache.deserialize(cached);
    }
  },
  afterCacheAccess: async (cacheContext: TokenCacheContext) => {
    if (!cacheSecrets || !cacheContext.cacheHasChanged) {
      return;
    }
    await cacheSecrets.store(MSAL_CACHE_SECRET_KEY, cacheContext.tokenCache.serialize());
  },
};

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
 * Interactive user sign-in via MSAL's public-client loopback flow — the same approach
 * (and default app id) Dataverse tooling like XrmToolBox uses. Opens the system browser
 * to sign in, then reuses MSAL's cached refresh token silently on renewal so it only
 * pops the browser when it genuinely has to. `promptIfNeeded` gates that browser prompt:
 * true on an explicit connect, false on background refresh.
 */
export async function acquireInteractiveToken(organizationUrl: string, clientId: string | undefined, promptIfNeeded: boolean): Promise<TokenResult | undefined> {
  return acquireInteractiveForScopes(buildDataverseScopes(organizationUrl), clientId, promptIfNeeded);
}

/**
 * Core interactive acquisition for any resource scope (a Dataverse org, or the Global
 * Discovery service). Reuses one cached MSAL public-client + account per clientId so a
 * single sign-in covers discovery and every environment: silent first, browser only
 * when promptIfNeeded and nothing usable is cached.
 */
export async function acquireInteractiveForScopes(scopes: string[], clientId: string | undefined, promptIfNeeded: boolean): Promise<TokenResult | undefined> {
  if (scopes.length === 0) {
    return undefined;
  }
  const effectiveClientId = (clientId ?? "").trim() || DEFAULT_INTERACTIVE_CLIENT_ID;
  const key = `${INTERACTIVE_AUTHORITY}|${effectiveClientId}`;
  let app = interactiveApps.get(key);
  if (!app) {
    app = { pca: new PublicClientApplication({ auth: { clientId: effectiveClientId, authority: INTERACTIVE_AUTHORITY }, cache: { cachePlugin } }) };
    interactiveApps.set(key, app);
  }

  // Recover the account from the persisted cache after a restart (the map is empty
  // but the refresh token was saved to secret storage), so we can renew silently.
  if (!app.account) {
    try {
      const accounts = await app.pca.getTokenCache().getAllAccounts();
      if (accounts.length > 0) {
        app.account = accounts[0];
      }
    } catch {
      // No persisted cache — an interactive sign-in will be needed.
    }
  }

  // Try silent first (MSAL's cached refresh token) so renewals don't reopen the browser.
  if (app.account) {
    try {
      const silent = await app.pca.acquireTokenSilent({ account: app.account, scopes });
      if (silent?.accessToken) {
        return { accessToken: silent.accessToken, expiresOn: silent.expiresOn ?? null };
      }
    } catch {
      // Cache miss / interaction required — fall through to an interactive sign-in.
    }
  }

  if (!promptIfNeeded) {
    // Background refresh with nothing usable cached; don't pop a browser unprompted.
    return undefined;
  }

  const result = await app.pca.acquireTokenInteractive({
    scopes,
    openBrowser: async (url: string) => {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    },
    successTemplate: SIGN_IN_SUCCESS_HTML,
    errorTemplate: SIGN_IN_ERROR_HTML,
  });
  if (!result?.accessToken) {
    return undefined;
  }
  app.account = result.account ?? app.account;
  return { accessToken: result.accessToken, expiresOn: result.expiresOn ?? null };
}
