import { vi } from "vitest";
import { fakeDataverseContext } from "./dataverseTestUtils";

// The two connection shapes a Dataverse path has to work under, and a recorder for what it sent (#143
// Move 2).
//
// A connection is either a SERVICE PRINCIPAL (tenant + client id + secret) or INTERACTIVE (OAuth). The
// difference that keeps causing bugs is what interactive does NOT have: **no tenantId and no client
// secret**. Anything that gates on those works in testing and fails for half the users — it has shipped
// that way at least five times (#91 typings, #90 register form events, #128/#129 early-bound, #159),
// and each one was found by a 15-30 minute interactive e2e rather than in CI.
//
// The rule (CLAUDE.md) is to gate on the live connection, never on `tenantId`. These helpers make that
// rule testable in milliseconds: run the same path under both shapes and assert it did the same thing.

export interface AuthShape {
  name: string;
  context: any;
  lines: string[];
}

/** Service principal: tenant, client id and secret all present. */
export function servicePrincipalShape(): AuthShape {
  const { context, lines } = fakeDataverseContext();
  context.projectSettings = {
    solutionName: "dvpttests",
    prefix: "dvpt",
    authType: "servicePrincipal",
    tenantId: "11111111-2222-3333-4444-555555555555",
    clientId: "66666666-7777-8888-9999-000000000000",
  };
  return { name: "service principal", context, lines };
}

/**
 * Interactive (OAuth): a live connection and a token, but **no tenantId and no client id/secret**. The
 * token authorises the call; the tenant is not part of the picture.
 */
export function interactiveShape(): AuthShape {
  const { context, lines } = fakeDataverseContext();
  context.projectSettings = {
    solutionName: "dvpttests",
    prefix: "dvpt",
    authType: "interactive",
    // deliberately absent: tenantId, clientId, clientSecret
  };
  return { name: "interactive (OAuth)", context, lines };
}

/** Both shapes, for `for (const shape of authShapes())` parity tests. */
export function authShapes(): AuthShape[] {
  return [servicePrincipalShape(), interactiveShape()];
}

export interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
  authorization?: string;
}

/**
 * Record every request a path makes, answering each with the next queued response.
 *
 * Comparing the RECORDED REQUESTS across the two shapes is the assertion that matters: a path that
 * silently skips a call under interactive (because a tenant check bailed out early) shows up as a
 * missing request, which "it returned true" would not catch.
 *
 * This patches the GLOBAL `fetch`, because the codebase uses two HTTP clients: some Dataverse paths
 * import `node-fetch` (mock it with `vi.mock`), others call the global. A spec that mocks only one
 * silently exercises nothing — which is exactly how this helper's first version passed while testing
 * no requests at all. Worth consolidating on one client; until then, cover both.
 */
export function recordRequests(responses: unknown[], nodeFetchMock?: ReturnType<typeof vi.fn>): { recorded: RecordedRequest[]; restore: () => void } {
  const recorded: RecordedRequest[] = [];
  const original = globalThis.fetch;
  let index = 0;
  const handler = async (url: unknown, init: any = {}): Promise<unknown> => {
    recorded.push({
      url: String(url),
      method: String(init.method ?? "GET"),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      authorization: init.headers?.Authorization,
    });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  };
  (globalThis as any).fetch = handler;
  // Paths that import node-fetch need their module mock driven too — pass it in. Without this the real
  // node-fetch runs and the test hangs on a network call to a URL that does not exist, which is how the
  // mixed-client split announced itself the first time.
  nodeFetchMock?.mockImplementation(handler as any);
  return {
    recorded,
    restore: () => {
      (globalThis as any).fetch = original;
      nodeFetchMock?.mockReset();
    },
  };
}
