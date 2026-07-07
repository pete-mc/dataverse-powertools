import { describe, it, expect, beforeAll } from "vitest";
import fetch from "node-fetch";
import { loadLiveEnv, LiveEnv } from "../liveEnv";

// Smoke test that the configured test environment is reachable end-to-end:
// service-principal token acquisition + a WhoAmI call. Skips when no creds.
const env = loadLiveEnv();

async function acquireToken(e: LiveEnv): Promise<string> {
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", e.clientId);
  params.append("client_secret", e.clientSecret);
  params.append("resource", e.url);
  const response = await fetch(`https://login.microsoftonline.com/${e.tenantId}/oauth2/token`, {
    method: "post",
    body: params,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data: any = await response.json();
  if (!data?.access_token) {
    // error_description carries the AADSTS diagnostic code (no secret in it).
    const detail = data?.error_description ? String(data.error_description).split("\n")[0] : data?.error ?? "unknown error";
    throw new Error(`Token request failed (${response.status}): ${detail}`);
  }
  return data.access_token as string;
}

it(env ? "live env is configured" : "live env NOT configured — skipping live tests (create .env from .env.example)", () => {
  expect(true).toBe(true);
});

const live = env ? describe : describe.skip;

live("live Dataverse connectivity", () => {
  let token = "";

  beforeAll(async () => {
    token = await acquireToken(env as LiveEnv);
  });

  it("acquires a service-principal access token", () => {
    expect(token.length).toBeGreaterThan(0);
  });

  it("calls WhoAmI successfully", async () => {
    const response = await fetch(`${(env as LiveEnv).url}/api/data/v9.2/WhoAmI`, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    expect(response.ok).toBe(true);
    const data: any = await response.json();
    expect(data?.UserId).toBeTruthy();
  });
});
