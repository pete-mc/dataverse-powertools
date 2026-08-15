import { describe, it, expect, vi } from "vitest";

// Two HTTP clients live in this codebase: some Dataverse paths import node-fetch, others call the global
// fetch. A spec that mocks only one silently exercises nothing — or hangs on a real network call, which
// is how this split first showed itself. Drive both.
vi.mock("node-fetch", () => ({ default: vi.fn() }));
import nodeFetch from "node-fetch";
import { authShapes, recordRequests } from "../../../test/authShapes";
import { okJson } from "../../../test/dataverseTestUtils";
import { addDataverseSolutionComponent } from "./addDataverseSolutionComponent";
import { getPluginTraceLogs } from "./getPluginTraceLogs";

// EVERY Dataverse path must work under BOTH auth types (#143 Move 2).
//
// A connection is either a service principal (tenant + client id + secret) or interactive (OAuth), and
// interactive has NO tenantId and NO secret. Code that gates on those works for whoever wrote it and
// fails for everyone signing in interactively — it has shipped that way at least five times (#91, #90,
// #128, #129, #159). Every one was caught by a 15-30 minute interactive e2e on a Windows VM, or by a
// user; none by CI.
//
// These run the real paths under both shapes in milliseconds and compare THE REQUESTS THEY SENT, not
// just their return values: a path that quietly skips a call under interactive (an early bail on a
// missing tenant) shows up here as a missing request, where "it returned true" would not.

/** Run one Dataverse path under both shapes and return what each actually sent. */
async function requestsUnderBothShapes(
  responses: unknown[],
  run: (context: any) => Promise<unknown>,
): Promise<{ servicePrincipal: unknown[]; interactive: unknown[]; results: unknown[] }> {
  const sent: unknown[][] = [];
  const results: unknown[] = [];
  for (const shape of authShapes()) {
    const { recorded, restore } = recordRequests(responses, nodeFetch as unknown as ReturnType<typeof vi.fn>);
    try {
      results.push(await run(shape.context));
    } finally {
      restore();
    }
    sent.push(recorded.map((request) => ({ url: request.url, method: request.method, body: request.body })));
  }
  return { servicePrincipal: sent[0], interactive: sent[1], results };
}

describe("addDataverseSolutionComponent", () => {
  it("issues the same AddSolutionComponent call under both auth types", async () => {
    const { servicePrincipal, interactive, results } = await requestsUnderBothShapes([okJson({})], (context) =>
      addDataverseSolutionComponent(context, "dvpttests", 66, "11111111-1111-1111-1111-111111111111"),
    );
    expect(results, "both succeeded").toEqual([true, true]);
    expect(servicePrincipal.length, "a request really was sent (not a no-op test)").toBeGreaterThan(0);
    expect(interactive, "interactive sent the same request as service principal").toEqual(servicePrincipal);
  });
});

describe("getPluginTraceLogs", () => {
  it("reads trace logs identically under both auth types", async () => {
    const { servicePrincipal, interactive, results } = await requestsUnderBothShapes([okJson({ value: [{ plugintracelogid: "1", typename: "Ns.Class, Asm" }] })], (context) =>
      getPluginTraceLogs(context, 5),
    );
    expect((results[0] as unknown[])?.length, "service principal got the row").toBe(1);
    expect((results[1] as unknown[])?.length, "interactive got the row too").toBe(1);
    expect(servicePrincipal.length, "a request really was sent").toBeGreaterThan(0);
    expect(interactive, "interactive queried the same resource").toEqual(servicePrincipal);
  });
});

describe("the interactive shape itself", () => {
  it("has no tenantId or client id — which is the whole point of these tests", () => {
    const [, interactive] = authShapes();
    expect(interactive.context.projectSettings.tenantId, "interactive must not carry a tenant").toBeUndefined();
    expect(interactive.context.projectSettings.clientId, "interactive must not carry a client id").toBeUndefined();
    // What it DOES have is a live connection and a token — the thing a Dataverse path may gate on.
    expect(interactive.context.dataverse.isValid).toBe(true);
    expect(interactive.context.dataverse.organizationUrl).toBeTruthy();
  });
});
