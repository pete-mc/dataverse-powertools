import { describe, it, expect, afterEach } from "vitest";
import { getPluginTraceLogs } from "./getPluginTraceLogs";
import { installDataverseFetchMock, DataverseFetchMock } from "../../../test/dataverseFetchMock";
import type DataversePowerToolsContext from "../../context";

// #143 flow-gap coverage — the plugin trace-log viewer (#63/#137) run against the Web API mock,
// no live org. Like the trace-level client, it must work identically under service-principal and
// interactive (OAuth) connections (never gate a Dataverse call on tenantId — #128/#129/#135).

const ORG_URL = "https://contoso.crm.dynamics.com";

function fakeContext(over: { isValid?: boolean; token?: string } = {}): DataversePowerToolsContext {
  return {
    channel: { appendLine: () => undefined, show: () => undefined },
    dataverse: {
      organizationUrl: ORG_URL,
      isValid: over.isValid ?? true,
      getAuthorizationToken: async () => over.token ?? "test-token",
    },
    projectSettings: {},
  } as unknown as DataversePowerToolsContext;
}

const rows = [
  { plugintracelogid: "11111111-0000-0000-0000-000000000001", typename: "Acme.MyPlugin", messagename: "Update", createdon: "2026-07-17T00:00:00Z" },
  { plugintracelogid: "11111111-0000-0000-0000-000000000002", typename: "Acme.Other", messagename: "Create", createdon: "2026-07-16T00:00:00Z" },
];

describe("getPluginTraceLogs against the Web API mock (#143 flow gaps)", () => {
  let mock: DataverseFetchMock | undefined;
  afterEach(() => mock?.restore());

  it("returns the trace-log rows the API serves", async () => {
    mock = installDataverseFetchMock({ pluginTraceLogs: rows });
    const result = await getPluginTraceLogs(fakeContext());
    expect(result).toHaveLength(2);
    expect(result?.[0].typename).toBe("Acme.MyPlugin");
  });

  it("returns [] when the org has no trace logs (not undefined)", async () => {
    mock = installDataverseFetchMock({ pluginTraceLogs: [] });
    expect(await getPluginTraceLogs(fakeContext())).toEqual([]);
  });

  it("requests plugintracelogs with $orderby desc + $top, carrying the Bearer token", async () => {
    mock = installDataverseFetchMock({ pluginTraceLogs: rows });
    await getPluginTraceLogs(fakeContext({ token: "oauth-token" }), 10);
    const req = mock.requests.find((r) => r.method === "GET");
    expect(req?.url).toContain("plugintracelogs?");
    expect(req?.url).toContain("$orderby=createdon");
    expect(req?.url).toContain("$top=10");
    expect(req?.authorization).toBe("Bearer oauth-token");
  });

  it("works under OAuth (no tenantId) exactly as under a service principal", async () => {
    mock = installDataverseFetchMock({ pluginTraceLogs: rows });
    // Same call, only the token differs — both connect the same way.
    expect((await getPluginTraceLogs(fakeContext({ token: "sp-token" })))?.length).toBe(2);
    expect((await getPluginTraceLogs(fakeContext({ token: "oauth-token" })))?.length).toBe(2);
  });

  it("returns undefined and makes no network call when the connection is invalid", async () => {
    mock = installDataverseFetchMock({ pluginTraceLogs: rows });
    expect(await getPluginTraceLogs(fakeContext({ isValid: false }))).toBeUndefined();
    expect(mock.requests.length).toBe(0);
  });
});
