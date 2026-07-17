import { describe, it, expect, afterEach } from "vitest";
import { getTraceLogSetting, setTraceLogSetting } from "./traceLogSetting";
import { installDataverseFetchMock, DataverseFetchMock } from "../../../test/dataverseFetchMock";
import type DataversePowerToolsContext from "../../context";

// #143 Move 2 — exercise a real Dataverse client (trace-log read/write) against the in-memory
// Web API mock, with NO live org. The point beyond "it parses": prove the call works
// IDENTICALLY under service-principal and interactive (OAuth) connections — the recurring
// bug class (#128/#129/#135) was gating Dataverse calls on tenantId, which OAuth doesn't carry.
// The clients gate on canCallDataverseApi({ organizationUrl, isValid }); the token authorises.

const ORG_URL = "https://contoso.crm.dynamics.com";

/** A fake context whose only Dataverse-relevant facts are the org URL, validity, and a token.
 * SP and OAuth differ only in authType/tenantId — which must NOT change behaviour. */
function fakeContext(over: { isValid?: boolean; tenantId?: string; authType?: string; token?: string } = {}): DataversePowerToolsContext {
  const logs: string[] = [];
  return {
    channel: { appendLine: (m: string) => logs.push(m), show: () => undefined },
    dataverse: {
      organizationUrl: ORG_URL,
      isValid: over.isValid ?? true,
      getAuthorizationToken: async () => over.token ?? "test-token",
    },
    projectSettings: { tenantId: over.tenantId },
  } as unknown as DataversePowerToolsContext;
}

const servicePrincipal = () => fakeContext({ tenantId: "aaaa-tenant", authType: "clientsecret", token: "sp-token" });
const interactive = () => fakeContext({ tenantId: undefined, authType: "oauth", token: "oauth-token" }); // OAuth carries NO tenantId

describe("Dataverse trace-log client against the Web API mock (#143 Move 2)", () => {
  let mock: DataverseFetchMock | undefined;
  afterEach(() => mock?.restore());

  it("reads the org trace level and parses it", async () => {
    mock = installDataverseFetchMock({ pluginTraceLogSetting: 2 });
    expect(await getTraceLogSetting(servicePrincipal())).toBe(2);
  });

  it("writes the trace level via PATCH and the mock reflects it", async () => {
    mock = installDataverseFetchMock({ pluginTraceLogSetting: 0 });
    const ok = await setTraceLogSetting(servicePrincipal(), 1);
    expect(ok).toBe(true);
    expect(mock.state.pluginTraceLogSetting).toBe(1);
    // A follow-up read sees the new value.
    expect(await getTraceLogSetting(servicePrincipal())).toBe(1);
  });

  it("behaves IDENTICALLY under OAuth (no tenantId) and service principal — the #128/#129/#135 guard", async () => {
    mock = installDataverseFetchMock({ pluginTraceLogSetting: 1 });
    expect(await getTraceLogSetting(interactive())).toBe(1);
    expect(await setTraceLogSetting(interactive(), 2)).toBe(true);
    expect(mock.state.pluginTraceLogSetting).toBe(2);
    // The interactive context never carried a tenantId, yet every call worked.
  });

  it("sends the connection's Bearer token on every call (the token authorises, not the tenant)", async () => {
    mock = installDataverseFetchMock();
    await getTraceLogSetting(interactive());
    expect(mock.requests.length).toBeGreaterThan(0);
    expect(mock.requests.every((r) => r.authorization === "Bearer oauth-token")).toBe(true);
  });

  it("targets the org Web API URL (base + /api/data/<version>/organizations)", async () => {
    mock = installDataverseFetchMock();
    await getTraceLogSetting(servicePrincipal());
    const get = mock.requests.find((r) => r.method === "GET");
    expect(get?.url).toContain(`${ORG_URL}/api/data/`);
    expect(get?.url).toContain("organizations?");
  });

  it("does not touch the network when the connection is not valid", async () => {
    mock = installDataverseFetchMock();
    expect(await getTraceLogSetting(fakeContext({ isValid: false }))).toBeUndefined();
    expect(await setTraceLogSetting(fakeContext({ isValid: false }), 2)).toBe(false);
    expect(mock.requests.length).toBe(0);
  });
});
