import * as path from "path";
import * as dotenv from "dotenv";
import { parseConnectionString, normalizeOrganizationUrl } from "../src/general/connectionString";

// Load credentials from a gitignored .env — either at the repo root or inside the
// gitignored sandbox/ folder. Root is loaded first; dotenv does not override vars
// that are already set, so an existing environment/root value wins. Never logs contents.
const repoRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.resolve(repoRoot, ".env") });
dotenv.config({ path: path.resolve(repoRoot, "sandbox", ".env") });

export interface LiveEnv {
  url: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  /** Optional test-only solution unique name (keeps live tests scoped). */
  solutionName?: string;
  /** Optional test-only publisher prefix. */
  publisherPrefix?: string;
}

/**
 * Read live-test credentials from the environment (a gitignored `.env`, or real
 * env vars in CI). Returns undefined when anything required is missing — callers
 * should skip (not fail) their live tests in that case, so unit/CI runs without
 * secrets stay green.
 *
 * Accepts either a full DVPT_TEST_CONNECTION_STRING or the discrete
 * DVPT_TEST_URL / DVPT_TEST_CLIENT_ID / DVPT_TEST_CLIENT_SECRET vars.
 */
export function loadLiveEnv(): LiveEnv | undefined {
  const tenantId = process.env.DVPT_TEST_TENANT_ID?.trim() ?? "";

  // Explicitly-set discrete vars take precedence; a full connection string only
  // fills whatever the discrete vars leave empty. (This way a leftover placeholder
  // connection string never overrides real discrete values.)
  let url = normalizeOrganizationUrl(process.env.DVPT_TEST_URL);
  let clientId = process.env.DVPT_TEST_CLIENT_ID?.trim() ?? "";
  let clientSecret = process.env.DVPT_TEST_CLIENT_SECRET?.trim() ?? "";

  if (!url || !clientId || !clientSecret) {
    const connectionString = process.env.DVPT_TEST_CONNECTION_STRING;
    if (connectionString) {
      const parts = parseConnectionString(connectionString);
      url = url || normalizeOrganizationUrl(parts.url);
      clientId = clientId || (parts.clientId ?? "");
      clientSecret = clientSecret || (parts.clientSecret ?? "");
    }
  }

  if (!url || !clientId || !clientSecret || !tenantId) {
    return undefined;
  }

  return {
    url,
    clientId,
    clientSecret,
    tenantId,
    solutionName: process.env.DVPT_TEST_SOLUTION_NAME?.trim() || undefined,
    publisherPrefix: process.env.DVPT_TEST_PUBLISHER_PREFIX?.trim() || undefined,
  };
}

export interface InteractiveTestUser {
  username: string;
  password: string;
}

/**
 * The MFA-exempt interactive ("Authenticated") test user (DVPT_TEST_USERNAME /
 * DVPT_TEST_PASSWORD), used to exercise the OAuth/interactive auth path — both the
 * extension's connection and unattended browser sign-in for Edge/Chrome. Returns
 * undefined when not configured, so tests that need it self-skip rather than fail.
 * The account must be excluded from MFA/conditional access (headless ROPC can't
 * satisfy an MFA challenge) and hold a Dataverse System Customizer/Administrator role.
 */
export function loadInteractiveTestUser(): InteractiveTestUser | undefined {
  const username = process.env.DVPT_TEST_USERNAME?.trim();
  const password = process.env.DVPT_TEST_PASSWORD;
  if (!username || !password) {
    return undefined;
  }
  return { username, password };
}

export interface TestSolutionConfig {
  solutionUniqueName: string;
  solutionFriendlyName: string;
  publisherUniqueName: string;
  publisherFriendlyName: string;
  prefix: string;
  optionValuePrefix: number;
}

/**
 * The dedicated test solution/publisher config. Live tests ensure this exists and
 * add anything they create to it, so test artifacts are easy to find (and the
 * solution can be deleted wholesale) instead of scattered in the Default layer.
 *
 * `env` is OPTIONAL on purpose. Vitest's `describe.skip` still INVOKES its callback to
 * collect the suite, so a spec that calls this at describe scope (the common shape here)
 * evaluates it even when the suite is skipped for want of credentials. Taking
 * `LiveEnv | undefined` and falling back to the same defaults keeps collection safe; a
 * skipped suite never runs a test, so these defaults are never used against a real org.
 */
export function testSolutionConfig(env?: LiveEnv): TestSolutionConfig {
  return {
    solutionUniqueName: env?.solutionName || "dvpttests",
    solutionFriendlyName: "Dataverse PowerTools Tests",
    publisherUniqueName: "dataversepowertoolstests",
    publisherFriendlyName: "Dataverse PowerTools Tests",
    prefix: env?.publisherPrefix || "dvpt",
    optionValuePrefix: 65200,
  };
}

/**
 * A placeholder org URL for collection-time expressions in suites that are about to be
 * skipped (see `testSolutionConfig` for why collection still happens). Parsing or string
 * -munging this is harmless; it is never fetched, because the suite does not run.
 */
export const PLACEHOLDER_ORG_URL = "https://placeholder.crm.dynamics.com";

/** The org URL for collection-time use: the real one, or a parseable placeholder when
 * credentials are absent and the suite is therefore skipped. */
export function liveOrgUrl(env?: LiveEnv): string {
  return env?.url || PLACEHOLDER_ORG_URL;
}

/** A complete `LiveEnv` of harmless placeholders. Empty credentials cannot authenticate against
 * anything, and the URL is only ever parsed or interpolated during collection. */
const PLACEHOLDER_LIVE_ENV: LiveEnv = { url: PLACEHOLDER_ORG_URL, clientId: "", clientSecret: "", tenantId: "" };

/**
 * The env for collection-time use. Use this instead of `env as LiveEnv` / `env!` at describe scope:
 * the cast satisfies the compiler but still dereferences `undefined` at runtime, which is what made
 * nine live spec FILES fail to load whenever credentials were absent — so a contributor without
 * `sandbox/.env` got TypeErrors instead of skips. A suite whose gate is false never runs a test, so
 * placeholders never reach an org.
 */
export function liveEnvOrPlaceholder(env?: LiveEnv): LiveEnv {
  return env ?? PLACEHOLDER_LIVE_ENV;
}
