/* eslint-disable @typescript-eslint/naming-convention -- Dataverse logical names */
import { describe, expect, it } from "vitest";
import {
  profilerConfigurationXml,
  parseProfilerConfiguration,
  stepsForAssemblyQuery,
  enableStepProfiling,
  disableStepProfiling,
  WebApiClient,
  PROFILED_NAME_SUFFIX,
} from "./profilerToggle";

const TYPE_ID = "11111111-2222-3333-4444-555555555555";
const PROFILER_TYPE_ID = "99999999-8888-7777-6666-555555555555";
const STEP_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("profilerConfigurationXml", () => {
  it("matches the DataContract serialization of a real ProfilerConfiguration", () => {
    // Reference produced by DataContractSerializer over PluginProfiler.Plugins.ProfilerConfiguration.
    const xml = profilerConfigurationXml({
      originalPluginTypeId: TYPE_ID,
      originalTypeName: "Contoso.AccountPlugin",
      originalConfiguration: "original-unsecure-config",
      persistenceSessionKey: "session-key-guid",
    });
    expect(xml).toBe(
      `<Configuration xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><AssemblyId xmlns:d2p1="http://schemas.microsoft.com/xrm/2011/Contracts" i:nil="true" /><Configuration>original-unsecure-config</Configuration><EventHandler xmlns:d2p1="http://schemas.microsoft.com/xrm/2011/Contracts"><d2p1:Id>${TYPE_ID}</d2p1:Id><d2p1:KeyAttributes xmlns:d3p1="http://schemas.microsoft.com/xrm/7.1/Contracts" xmlns:d3p2="http://schemas.datacontract.org/2004/07/System.Collections.Generic" /><d2p1:LogicalName>plugintype</d2p1:LogicalName><d2p1:Name i:nil="true" /><d2p1:RowVersion i:nil="true" /></EventHandler><IncludeSecureInformation>false</IncludeSecureInformation><IsContextReplay i:nil="true" /><IsProfilePersistedToEntity>true</IsProfilePersistedToEntity><MaxNumberOfExecutions>100</MaxNumberOfExecutions><OriginalEventHandlerName>Contoso.AccountPlugin</OriginalEventHandlerName><PersistenceSessionKey>session-key-guid</PersistenceSessionKey><TypeName>Contoso.AccountPlugin</TypeName><WorkflowStepId i:nil="true" /></Configuration>`,
    );
  });

  it("round-trips through parseProfilerConfiguration, including a nil original config", () => {
    const withConfig = profilerConfigurationXml({ originalPluginTypeId: TYPE_ID, originalTypeName: "Contoso.X", originalConfiguration: "<xml/>", persistenceSessionKey: "k" });
    expect(parseProfilerConfiguration(withConfig)).toEqual({ originalPluginTypeId: TYPE_ID, originalTypeName: "Contoso.X", originalConfiguration: "<xml/>" });
    const nil = profilerConfigurationXml({ originalPluginTypeId: TYPE_ID, originalTypeName: "Contoso.X", originalConfiguration: null, persistenceSessionKey: "k" });
    expect(parseProfilerConfiguration(nil)).toEqual({ originalPluginTypeId: TYPE_ID, originalTypeName: "Contoso.X", originalConfiguration: null });
  });

  it("does not mistake a normal configuration for a profiled one", () => {
    expect(parseProfilerConfiguration("<MyPluginSettings/>")).toBeUndefined();
    expect(parseProfilerConfiguration(null)).toBeUndefined();
  });
});

describe("stepsForAssemblyQuery", () => {
  it("filters by the project's assembly and escapes quotes", () => {
    const query = stepsForAssemblyQuery("O'Brien.Plugins");
    expect(query).toContain("pluginassemblyid/name eq 'O''Brien.Plugins'");
    expect(query).toContain("$expand=plugintypeid");
  });
});

const PROFILER_STEP_ID = "77777777-6666-5555-4444-333333333333";

interface FakeClient extends WebApiClient {
  posts: { path: string; body: Record<string, unknown> }[];
  patches: { path: string; body: Record<string, unknown> }[];
  deletes: string[];
  originalStep: Record<string, unknown>;
}

function fakeClient(originalStep: Record<string, unknown>): FakeClient {
  const client: FakeClient = {
    posts: [],
    patches: [],
    deletes: [],
    originalStep: { ...originalStep },
    async get(path: string) {
      if (path.startsWith("plugintypes?")) {
        return { value: [{ plugintypeid: PROFILER_TYPE_ID }] };
      }
      if (path.startsWith("sdkmessageprocessingstepimages?")) {
        return { value: [] };
      }
      // step fetch (full or statecode-only) — return the current original state.
      return client.originalStep;
    },
    async post(path: string, body: Record<string, unknown>) {
      client.posts.push({ path, body });
      return PROFILER_STEP_ID;
    },
    async patch(path: string, body: Record<string, unknown>) {
      client.patches.push({ path, body });
      if (path.includes(STEP_ID)) {
        Object.assign(client.originalStep, body);
      }
      return undefined;
    },
    async del(path: string) {
      client.deletes.push(path);
      return undefined;
    },
  };
  return client;
}

describe("enable/disable round trip (create profiler step + disable original)", () => {
  const originalStep = {
    sdkmessageprocessingstepid: STEP_ID,
    name: "Contoso.AccountPlugin: Create of account",
    configuration: "orig-config",
    stage: 40,
    mode: 0,
    rank: 1,
    supporteddeployment: 0,
    statecode: 0,
    _plugintypeid_value: TYPE_ID,
    _sdkmessageid_value: "msg-id",
    _sdkmessagefilterid_value: "filter-id",
    plugintypeid: { typename: "Contoso.AccountPlugin" },
  };

  it("creates a (Profiled) step routed through the profiler and disables the original", async () => {
    const client = fakeClient(originalStep);
    const snapshot = await enableStepProfiling(client, STEP_ID, "session-1");

    // A new profiler step was created, copying the original's message/filter/stage.
    const created = client.posts.find((p) => p.path === "sdkmessageprocessingsteps")!;
    expect(created.body["plugintypeid@odata.bind"]).toBe(`/plugintypes(${PROFILER_TYPE_ID})`);
    expect(created.body["sdkmessageid@odata.bind"]).toBe("/sdkmessages(msg-id)");
    expect(created.body["sdkmessagefilterid@odata.bind"]).toBe("/sdkmessagefilters(filter-id)");
    expect(created.body.stage).toBe(40);
    expect(String(created.body.name)).toContain(PROFILED_NAME_SUFFIX);
    expect(String(created.body.configuration)).toContain("<IsProfilePersistedToEntity>true</IsProfilePersistedToEntity>");

    // The ORIGINAL step was disabled.
    const disable = client.patches.find((p) => p.path.includes(STEP_ID))!;
    expect(disable.body.statecode).toBe(1);

    expect(snapshot).toEqual({ originalStepId: STEP_ID, profilerStepId: PROFILER_STEP_ID, name: originalStep.name, typename: "Contoso.AccountPlugin" });

    // Restore: delete the profiler step, re-enable the original.
    await disableStepProfiling(client, snapshot);
    expect(client.deletes).toContain(`sdkmessageprocessingsteps(${PROFILER_STEP_ID})`);
    const reenable = client.patches.filter((p) => p.path.includes(STEP_ID)).pop()!;
    expect(reenable.body.statecode).toBe(0);
  });

  it("refuses to profile a step that is already a profiler step", async () => {
    const client = fakeClient({ ...originalStep, plugintypeid: { typename: "PluginProfiler.Plugins.ProfilerPlugin" } });
    await expect(enableStepProfiling(client, STEP_ID, "s")).rejects.toThrow(/already a profiler step/);
  });

  it("rolls back the created profiler step if disabling the original fails", async () => {
    const client = fakeClient(originalStep);
    client.patch = async (path: string) => {
      if (path.includes(STEP_ID)) {
        throw new Error("disable failed");
      }
    };
    await expect(enableStepProfiling(client, STEP_ID, "s")).rejects.toThrow(/disable failed/);
    expect(client.deletes).toContain(`sdkmessageprocessingsteps(${PROFILER_STEP_ID})`);
  });
});
