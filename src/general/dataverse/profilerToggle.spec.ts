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

function fakeClient(step: Record<string, unknown>): WebApiClient & { patches: { path: string; body: Record<string, unknown> }[] } {
  const state = { step: { ...step } };
  return {
    patches: [],
    async get(path: string) {
      if (path.startsWith("plugintypes?")) {
        return { value: [{ plugintypeid: PROFILER_TYPE_ID }] };
      }
      return state.step;
    },
    async patch(path: string, body: Record<string, unknown>) {
      this.patches.push({ path, body });
      Object.assign(state.step, body);
      if (body["plugintypeid@odata.bind"]) {
        state.step._plugintypeid_value = String(body["plugintypeid@odata.bind"]).replace(/^\/plugintypes\(|\)$/g, "");
      }
    },
  };
}

describe("enable/disable round trip", () => {
  const originalStep = {
    sdkmessageprocessingstepid: STEP_ID,
    name: "Contoso.AccountPlugin: Create of account",
    configuration: "orig-config",
    _plugintypeid_value: TYPE_ID,
    plugintypeid: { typename: "Contoso.AccountPlugin" },
  };

  it("rewires to the profiler type carrying the original identity, then restores byte-identical", async () => {
    const client = fakeClient(originalStep);
    const snapshot = await enableStepProfiling(client, STEP_ID, "session-1");
    expect(snapshot.plugintypeid).toBe(TYPE_ID);
    expect(client.patches[0].body["plugintypeid@odata.bind"]).toBe(`/plugintypes(${PROFILER_TYPE_ID})`);
    expect(String(client.patches[0].body.name)).toContain(PROFILED_NAME_SUFFIX);

    await disableStepProfiling(client, STEP_ID, snapshot);
    const restore = client.patches[1].body;
    expect(restore["plugintypeid@odata.bind"]).toBe(`/plugintypes(${TYPE_ID})`);
    expect(restore.configuration).toBe("orig-config");
    expect(restore.name).toBe(originalStep.name);
  });

  it("refuses to double-profile a step", async () => {
    const client = fakeClient(originalStep);
    await enableStepProfiling(client, STEP_ID, "s");
    await expect(enableStepProfiling(client, STEP_ID, "s")).rejects.toThrow(/already profiled/);
  });

  it("refuses to 'restore' an unprofiled step without a backup", async () => {
    const client = fakeClient(originalStep);
    await expect(disableStepProfiling(client, STEP_ID)).rejects.toThrow(/does not look profiled/);
  });
});
