// Ensure a dedicated, isolated Dataverse solution exists for the supervised UI test, so the
// Initialise Project wizard can pick it (the wizard only picks EXISTING solutions). Idempotent:
// creates it once under the existing test publisher, then reuses it. Authenticates with the same
// service-principal creds the e2e uses (sandbox/.env). Prints the solution's friendly name on the
// last stdout line, which runSupervised.mjs reads into DVPT_SUPERVISED_SOLUTION.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "/api/data/v9.2";
const SUPERVISED_UNIQUE = "DVPTSupervised";
const SUPERVISED_FRIENDLY = "DVPT Supervised";

function loadEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync(path.join(root, "sandbox", ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !line.trimStart().startsWith("#")) {
        env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env */
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const url = (env.DVPT_TEST_URL || "").replace(/\/+$/, "");
  const tenant = env.DVPT_TEST_TENANT_ID;
  const clientId = env.DVPT_TEST_CLIENT_ID;
  const clientSecret = env.DVPT_TEST_CLIENT_SECRET;
  const prefix = env.DVPT_TEST_PUBLISHER_PREFIX;
  if (!url || !tenant || !clientId || !clientSecret) {
    console.error("[solution] missing DVPT_TEST_URL/TENANT_ID/CLIENT_ID/CLIENT_SECRET in sandbox/.env — cannot ensure the supervised solution.");
    process.exit(1);
  }

  // Service-principal token for the org.
  const params = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, resource: url });
  const tokRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const tok = await tokRes.json();
  if (!tok?.access_token) {
    console.error(`[solution] auth failed: ${JSON.stringify(tok).slice(0, 200)}`);
    process.exit(1);
  }
  const headers = { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0", Accept: "application/json" };
  const get = async (q) => (await fetch(`${url}${API}/${q}`, { headers })).json();

  // Already there? Reuse.
  const existing = await get(`solutions?$select=solutionid,uniquename,friendlyname&$filter=uniquename eq '${SUPERVISED_UNIQUE}'`);
  if (existing?.value?.length) {
    console.error(`[solution] reusing existing "${existing.value[0].friendlyname}" (${SUPERVISED_UNIQUE}).`);
    console.log(existing.value[0].friendlyname);
    return;
  }

  // Find a publisher: by the configured prefix, else the publisher of the existing test solution.
  let publisherId;
  if (prefix) {
    const byPrefix = await get(`publishers?$select=publisherid&$filter=customizationprefix eq '${prefix}'`);
    publisherId = byPrefix?.value?.[0]?.publisherid;
  }
  if (!publisherId && env.DVPT_TEST_SOLUTION_NAME) {
    const sol = await get(`solutions?$select=_publisherid_value&$filter=uniquename eq '${env.DVPT_TEST_SOLUTION_NAME}'`);
    publisherId = sol?.value?.[0]?.["_publisherid_value"];
  }
  if (!publisherId) {
    console.error("[solution] could not resolve a publisher (checked DVPT_TEST_PUBLISHER_PREFIX and DVPT_TEST_SOLUTION_NAME's publisher).");
    process.exit(1);
  }

  const createRes = await fetch(`${url}${API}/solutions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ uniquename: SUPERVISED_UNIQUE, friendlyname: SUPERVISED_FRIENDLY, version: "1.0.0.0", "publisherid@odata.bind": `/publishers(${publisherId})` }),
  });
  if (!createRes.ok) {
    console.error(`[solution] create failed (${createRes.status}): ${(await createRes.text()).slice(0, 300)}`);
    process.exit(1);
  }
  console.error(`[solution] created "${SUPERVISED_FRIENDLY}" (${SUPERVISED_UNIQUE}).`);
  console.log(SUPERVISED_FRIENDLY);
}

main().catch((e) => {
  console.error(`[solution] ${e}`);
  process.exit(1);
});
