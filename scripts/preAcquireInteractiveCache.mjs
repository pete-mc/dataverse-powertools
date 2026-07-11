// Pre-seed an MSAL token cache for the interactive (OAuth) e2e suites.
//
// The extension's interactive sign-in opens a system browser (MSAL loopback flow), which cannot be
// driven inside ExTester's VS Code host. Instead, these tests point DVPT_TEST_MSAL_CACHE_FILE at a
// cache this script pre-populates headlessly, using the ROPC (username/password) flow with the
// MFA-exempt test user from sandbox/.env. The extension's cache plugin (src/general/dataverse/
// tokenAcquisition.ts) then deserializes it and acquires tokens *silently* — no browser.
//
// This must stay in sync with the extension's public client + authority (below). Best-effort: if
// creds are missing or ROPC is rejected, it exits non-zero and the interactive suites self-skip.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PublicClientApplication } from "@azure/msal-node";

// Keep in lockstep with DEFAULT_INTERACTIVE_CLIENT_ID in src/general/dataverse/tokenAcquisition.ts
// (Microsoft's well-known sample public client, http://localhost registered, Dataverse delegated).
const DEFAULT_INTERACTIVE_CLIENT_ID = "51f81489-12ee-4a9e-aaae-a2591f45987d";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = {};
  const file = path.join(root, "sandbox", ".env");
  if (!fs.existsSync(file)) {
    return env;
  }
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !line.trimStart().startsWith("#")) {
      env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const username = env.DVPT_TEST_USERNAME;
  const password = env.DVPT_TEST_PASSWORD;
  const tenantId = env.DVPT_TEST_TENANT_ID;
  const orgUrl = (env.DVPT_TEST_URL || "").replace(/\/+$/, "");
  // The suites and the extension read the SAME env var for the cache path; default under sandbox/.
  const cacheFile = process.env.DVPT_TEST_MSAL_CACHE_FILE || path.join(root, "sandbox", ".msal-test-cache.json");

  if (!username || !password || !tenantId || !orgUrl) {
    console.error("[seed-msal] missing DVPT_TEST_USERNAME/PASSWORD/TENANT_ID/URL in sandbox/.env — cannot seed; interactive suites will skip.");
    process.exit(1);
  }

  // ROPC needs a tenant-specific authority (unlike the extension's runtime "organizations" authority,
  // which resolves the cached account's home tenant on silent renewal).
  const pca = new PublicClientApplication({
    auth: { clientId: DEFAULT_INTERACTIVE_CLIENT_ID, authority: `https://login.microsoftonline.com/${tenantId}` },
    cache: {
      cachePlugin: {
        beforeCacheAccess: async (ctx) => {
          try {
            if (fs.existsSync(cacheFile)) {
              ctx.tokenCache.deserialize(fs.readFileSync(cacheFile, "utf8"));
            }
          } catch {
            /* start fresh */
          }
        },
        afterCacheAccess: async (ctx) => {
          if (ctx.cacheHasChanged) {
            fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
            fs.writeFileSync(cacheFile, ctx.tokenCache.serialize());
          }
        },
      },
    },
  });

  const scopes = [`${orgUrl}/.default`];
  console.log(`[seed-msal] acquiring token for ${username.replace(/(.).*(@.*)/, "$1***$2")} → ${orgUrl} (ROPC)…`);
  const result = await pca.acquireTokenByUsernamePassword({ scopes, username, password });
  if (!result?.accessToken) {
    throw new Error("no access token returned");
  }

  // Confirm the cache actually holds an account the extension can renew from.
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (accounts.length === 0) {
    throw new Error("token acquired but no account persisted to the cache");
  }
  console.log(`[seed-msal] OK — cached ${accounts.length} account(s) to ${cacheFile}`);
  console.log(`[seed-msal] DVPT_TEST_MSAL_CACHE_FILE=${cacheFile}`);
}

main().catch((e) => {
  const msg = e?.errorMessage || e?.message || String(e);
  console.error(`[seed-msal] FAILED: ${msg}`);
  process.exit(1);
});
