/* eslint-disable @typescript-eslint/naming-convention -- record fields are Dataverse logical names */
import { describe, it, expect, afterEach } from "vitest";
import {
  getPluginAssemblyProfilingInfo,
  setPluginAssemblyContent,
  getProfilableSteps,
  deleteProfilerStep,
  isProfilerInstalled,
  getPluginProfiles,
  getPluginProfileContent,
} from "./pluginProfiles";
import { installDataverseFetchMock, DataverseFetchMock } from "../../../test/dataverseFetchMock";
import type DataversePowerToolsContext from "../../context";

// #143 Move 2 — drive the Plugin Profiler's Web API path (the largest untested global-`fetch`
// surface: assembly profiling-prep, profilable-step discovery, profiler-clone cleanup, profile
// download) against the in-memory Web API mock, with NO live org. Beyond "it parses":
//   1. the auth path is IDENTICAL under service-principal and interactive (OAuth) — the recurring
//      #128/#129/#135 bug class (OAuth carries no tenantId; the token authorises, not the tenant);
//   2. the request is SHAPED correctly (server-side assembly filter for #135/#140; keyed PATCH/DELETE);
//   3. an invalid connection short-circuits without touching the network.

const ORG_URL = "https://contoso.crm.dynamics.com";
const ASSEMBLY = "Contoso.Plugins";
const ASSEMBLY_ID = "11111111-1111-1111-1111-111111111111";
const PACKAGE_ID = "22222222-2222-2222-2222-222222222222";
const PROFILER_STEP_ID = "33333333-3333-3333-3333-333333333333";
const PROFILE_ID = "44444444-4444-4444-4444-444444444444";

function fakeContext(over: { isValid?: boolean; tenantId?: string; token?: string } = {}): DataversePowerToolsContext {
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

const servicePrincipal = () => fakeContext({ tenantId: "aaaa-tenant", token: "sp-token" });
const interactive = () => fakeContext({ tenantId: undefined, token: "oauth-token" }); // OAuth carries NO tenantId

/** A step-row triplet: one profilable user step, one system (Microsoft.*) step, one (Profiled) clone. */
function seedSteps() {
  return [
    {
      sdkmessageprocessingstepid: PROFILER_STEP_ID,
      name: "Contoso.AccountPlugin: Create of account",
      mode: 0,
      statecode: 0,
      sdkmessageid: { name: "Create" },
      sdkmessagefilterid: { primaryobjecttypecode: "account" },
      plugintypeid: { typename: "Contoso.AccountPlugin", pluginassemblyid: { name: ASSEMBLY } },
    },
    {
      sdkmessageprocessingstepid: "55555555-5555-5555-5555-555555555555",
      name: "System step",
      plugintypeid: { typename: "Microsoft.Crm.SomeSystemPlugin", pluginassemblyid: { name: "Microsoft.Crm" } },
    },
    {
      sdkmessageprocessingstepid: "66666666-6666-6666-6666-666666666666",
      name: "Contoso.AccountPlugin (Profiled)",
      plugintypeid: { typename: "Contoso.AccountPlugin", pluginassemblyid: { name: ASSEMBLY } },
    },
  ];
}

describe("Plugin Profiler Web API path against the mock (#143 Move 2)", () => {
  let mock: DataverseFetchMock | undefined;
  afterEach(() => mock?.restore());

  it("resolves a PACKAGE assembly's profiling info (null content → needs preparing)", async () => {
    mock = installDataverseFetchMock({ pluginAssemblies: [{ pluginassemblyid: ASSEMBLY_ID, name: ASSEMBLY, content: null, packageId: PACKAGE_ID }] });
    const info = await getPluginAssemblyProfilingInfo(servicePrincipal(), ASSEMBLY);
    expect(info).toEqual({ assemblyId: ASSEMBLY_ID, packageId: PACKAGE_ID, hasContent: false });
    // Filtered server-side by name, top 1.
    const get = mock.requests.find((r) => r.method === "GET" && r.url.includes("pluginassemblies?"));
    expect(get?.url).toContain(`name eq '${ASSEMBLY}'`);
    expect(get?.url).toContain("$top=1");
  });

  it("reports hasContent=true for a classic (content-populated) assembly, and undefined for an unknown one", async () => {
    mock = installDataverseFetchMock({ pluginAssemblies: [{ pluginassemblyid: ASSEMBLY_ID, name: ASSEMBLY, content: "QUJD" }] });
    expect((await getPluginAssemblyProfilingInfo(servicePrincipal(), ASSEMBLY))?.hasContent).toBe(true);
    expect(await getPluginAssemblyProfilingInfo(servicePrincipal(), "Nope.Missing")).toBeUndefined();
  });

  it("populates a package assembly's content via PATCH, and the mock reflects it (0.14.43 prep)", async () => {
    mock = installDataverseFetchMock({ pluginAssemblies: [{ pluginassemblyid: ASSEMBLY_ID, name: ASSEMBLY, content: null, packageId: PACKAGE_ID }] });
    const ok = await setPluginAssemblyContent(servicePrincipal(), ASSEMBLY_ID, "QkFTRTY0");
    expect(ok).toBe(true);
    expect(mock.state.pluginAssemblies[0].content).toBe("QkFTRTY0");
    // A follow-up read now sees content present.
    expect((await getPluginAssemblyProfilingInfo(servicePrincipal(), ASSEMBLY))?.hasContent).toBe(true);
    const patch = mock.requests.find((r) => r.method === "PATCH");
    expect(patch?.url).toContain(`pluginassemblies(${ASSEMBLY_ID})`);
    expect(patch?.body).toEqual({ content: "QkFTRTY0" });
  });

  it("rejects a non-GUID assembly id without touching the network", async () => {
    mock = installDataverseFetchMock();
    expect(await setPluginAssemblyContent(servicePrincipal(), "not-a-guid", "QQ==")).toBe(false);
    expect(mock.requests.length).toBe(0);
  });

  it("lists profilable steps, dropping system + (Profiled) rows, filtered server-side by assembly (#135/#140)", async () => {
    mock = installDataverseFetchMock({ sdkMessageProcessingSteps: seedSteps() });
    const steps = await getProfilableSteps(servicePrincipal(), ASSEMBLY);
    expect(steps).toHaveLength(1);
    expect(steps?.[0]).toMatchObject({ stepId: PROFILER_STEP_ID, typeName: "Contoso.AccountPlugin", assemblyName: ASSEMBLY, message: "Create", primaryEntity: "account", mode: 0 });
    // The busy-org fix: the query filters by assembly server-side, not client-side over the first 200.
    const get = mock.requests.find((r) => r.method === "GET" && r.url.includes("sdkmessageprocessingsteps?"));
    expect(get?.url).toContain("plugintypeid/pluginassemblyid/name eq 'Contoso.Plugins'");
  });

  it("deletes a profiler clone step (Web-API 'Stop' fallback), and the mock drops it", async () => {
    mock = installDataverseFetchMock({ sdkMessageProcessingSteps: seedSteps() });
    const ok = await deleteProfilerStep(servicePrincipal(), PROFILER_STEP_ID);
    expect(ok).toBe(true);
    expect(mock.state.sdkMessageProcessingSteps.some((s) => s.sdkmessageprocessingstepid === PROFILER_STEP_ID)).toBe(false);
    const del = mock.requests.find((r) => r.method === "DELETE");
    expect(del?.url).toContain(`sdkmessageprocessingsteps(${PROFILER_STEP_ID})`);
    // A non-GUID id short-circuits.
    expect(await deleteProfilerStep(servicePrincipal(), "bad")).toBe(false);
  });

  it("detects the profiler solution (present vs absent)", async () => {
    mock = installDataverseFetchMock({ solutions: [{ solutionid: "s1", version: "9.1.0.200" }] });
    expect(await isProfilerInstalled(servicePrincipal())).toBe(true);
    mock.restore();
    mock = installDataverseFetchMock({ solutions: [] });
    expect(await isProfilerInstalled(servicePrincipal())).toBe(false);
  });

  it("lists captured profiles and downloads one report by id", async () => {
    mock = installDataverseFetchMock({
      pluginProfiles: [{ mbs_pluginprofileid: PROFILE_ID, mbs_typename: "Contoso.AccountPlugin", mbs_messagename: "Create", mbs_profile: "REVGTEFURUQ=" }],
    });
    const list = await getPluginProfiles(servicePrincipal());
    expect(list).toHaveLength(1);
    expect(list?.[0].mbs_typename).toBe("Contoso.AccountPlugin");
    expect(await getPluginProfileContent(servicePrincipal(), PROFILE_ID)).toBe("REVGTEFURUQ=");
  });

  it("behaves IDENTICALLY under OAuth (no tenantId) and service principal — the #128/#129/#135 guard", async () => {
    const steps = seedSteps();
    mock = installDataverseFetchMock({
      sdkMessageProcessingSteps: steps,
      pluginAssemblies: [{ pluginassemblyid: ASSEMBLY_ID, name: ASSEMBLY, content: null, packageId: PACKAGE_ID }],
    });
    // Same discovery result under interactive auth…
    expect((await getProfilableSteps(interactive(), ASSEMBLY))?.[0]?.stepId).toBe(PROFILER_STEP_ID);
    // …and the same mutation works with no tenantId in play.
    expect(await setPluginAssemblyContent(interactive(), ASSEMBLY_ID, "T0s=")).toBe(true);
    expect(mock.state.pluginAssemblies[0].content).toBe("T0s=");
  });

  it("sends the connection's Bearer token on every profiler call (the token authorises, not the tenant)", async () => {
    mock = installDataverseFetchMock({ sdkMessageProcessingSteps: seedSteps() });
    await getProfilableSteps(interactive(), ASSEMBLY);
    await deleteProfilerStep(interactive(), PROFILER_STEP_ID);
    expect(mock.requests.length).toBeGreaterThan(0);
    expect(mock.requests.every((r) => r.authorization === "Bearer oauth-token")).toBe(true);
  });

  it("does not touch the network when the connection is not valid", async () => {
    mock = installDataverseFetchMock({ pluginAssemblies: [{ pluginassemblyid: ASSEMBLY_ID, name: ASSEMBLY, content: null }], sdkMessageProcessingSteps: seedSteps() });
    const bad = fakeContext({ isValid: false });
    expect(await getPluginAssemblyProfilingInfo(bad, ASSEMBLY)).toBeUndefined();
    expect(await getProfilableSteps(bad, ASSEMBLY)).toBeUndefined();
    expect(await setPluginAssemblyContent(bad, ASSEMBLY_ID, "QQ==")).toBe(false);
    expect(await deleteProfilerStep(bad, PROFILER_STEP_ID)).toBe(false);
    expect(await isProfilerInstalled(bad)).toBeUndefined();
    expect(mock.requests.length).toBe(0);
  });
});
