/* eslint-disable @typescript-eslint/naming-convention -- record fields are Dataverse logical names */
import { describe, it, expect } from "vitest";
import {
  buildProfilerConfiguration,
  parseProfilerConfiguration,
  buildProfilerStepPayload,
  profilerPluginTypeQuery,
  stepToCloneQuery,
  stepImagesQuery,
  profilerCloneName,
  profiledOriginalName,
  PROFILER_STEP_DESCRIPTION,
  STEP_STATE_DISABLED,
  STEP_STATE_ENABLED,
} from "./profilerSteps";

// The configuration blob is deserialized SERVER-SIDE by the Plugin Profiler's own plug-in,
// using a DataContractSerializer over PluginProfiler.Plugins.ProfilerConfiguration. So the
// bytes are a contract with someone else's code, not an internal detail.
//
// GOLDEN below is the literal output of a real DataContractSerializer writing that contract
// (reproduced in a net8 console app from the decompiled [DataContract]/[DataMember]
// declarations, PRT 9.1.0.200). If a change here breaks this test, the profiler will fail to
// read the blob at runtime — regenerate the golden rather than editing it to match.
const GOLDEN =
  '<Configuration xmlns:i="http://www.w3.org/2001/XMLSchema-instance">' +
  '<AssemblyId xmlns:a="http://schemas.microsoft.com/xrm/2011/Contracts">' +
  "<a:Id>11111111-1111-1111-1111-111111111111</a:Id>" +
  '<a:KeyAttributes xmlns:b="http://schemas.microsoft.com/xrm/7.1/Contracts" xmlns:c="http://schemas.datacontract.org/2004/07/System.Collections.Generic"/>' +
  "<a:LogicalName>pluginassembly</a:LogicalName>" +
  '<a:Name i:nil="true"/>' +
  '<a:RowVersion i:nil="true"/>' +
  "</AssemblyId>" +
  '<Configuration i:nil="true"/>' +
  '<EventHandler xmlns:a="http://schemas.microsoft.com/xrm/2011/Contracts">' +
  "<a:Id>22222222-2222-2222-2222-222222222222</a:Id>" +
  '<a:KeyAttributes xmlns:b="http://schemas.microsoft.com/xrm/7.1/Contracts" xmlns:c="http://schemas.datacontract.org/2004/07/System.Collections.Generic"/>' +
  "<a:LogicalName>sdkmessageprocessingstep</a:LogicalName>" +
  '<a:Name i:nil="true"/>' +
  '<a:RowVersion i:nil="true"/>' +
  "</EventHandler>" +
  "<IncludeSecureInformation>false</IncludeSecureInformation>" +
  '<IsContextReplay i:nil="true"/>' +
  "<IsProfilePersistedToEntity>true</IsProfilePersistedToEntity>" +
  "<MaxNumberOfExecutions>100</MaxNumberOfExecutions>" +
  "<OriginalEventHandlerName>DVPT probe: Create of territory</OriginalEventHandlerName>" +
  "<PersistenceSessionKey>abc123</PersistenceSessionKey>" +
  "<TypeName>DvptProbe.ProbePlugin</TypeName>" +
  '<WorkflowStepId i:nil="true"/>' +
  "</Configuration>";

describe("buildProfilerConfiguration", () => {
  it("matches a real DataContractSerializer's output byte for byte", () => {
    const xml = buildProfilerConfiguration({
      assemblyId: "11111111-1111-1111-1111-111111111111",
      typeName: "DvptProbe.ProbePlugin",
      stepId: "22222222-2222-2222-2222-222222222222",
      originalEventHandlerName: "DVPT probe: Create of territory",
      maxNumberOfExecutions: 100,
      persistenceSessionKey: "abc123",
      includeSecureInformation: false,
      isProfilePersistedToEntity: true,
    });
    expect(xml).toBe(GOLDEN);
  });

  it("emits unset members as nil rather than omitting them", () => {
    const xml = buildProfilerConfiguration({
      assemblyId: "11111111-1111-1111-1111-111111111111",
      typeName: "T",
      stepId: "22222222-2222-2222-2222-222222222222",
      originalEventHandlerName: "n",
    });
    expect(xml).toContain('<MaxNumberOfExecutions i:nil="true"/>');
    expect(xml).toContain('<PersistenceSessionKey i:nil="true"/>');
    expect(xml).toContain('<IncludeSecureInformation i:nil="true"/>');
  });

  it("keeps members in alphabetical order (the deserializer is order-sensitive)", () => {
    const xml = buildProfilerConfiguration({
      assemblyId: "11111111-1111-1111-1111-111111111111",
      typeName: "T",
      stepId: "22222222-2222-2222-2222-222222222222",
      originalEventHandlerName: "n",
    });
    const order = [
      "AssemblyId",
      "<Configuration i",
      "EventHandler",
      "IncludeSecureInformation",
      "IsContextReplay",
      "IsProfilePersistedToEntity",
      "MaxNumberOfExecutions",
      "OriginalEventHandlerName",
      "PersistenceSessionKey",
      "TypeName",
      "WorkflowStepId",
    ];
    const positions = order.map((member) => xml.indexOf(member));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it("escapes XML in a step name", () => {
    const xml = buildProfilerConfiguration({
      assemblyId: "11111111-1111-1111-1111-111111111111",
      typeName: "T",
      stepId: "22222222-2222-2222-2222-222222222222",
      originalEventHandlerName: "A & B <step>",
    });
    expect(xml).toContain("<OriginalEventHandlerName>A &amp; B &lt;step&gt;</OriginalEventHandlerName>");
  });
});

describe("parseProfilerConfiguration", () => {
  it("reads back what Stop Profiling needs", () => {
    const parsed = parseProfilerConfiguration(GOLDEN);
    expect(parsed.stepId).toBe("22222222-2222-2222-2222-222222222222");
    expect(parsed.originalEventHandlerName).toBe("DVPT probe: Create of territory");
  });

  it("round-trips an escaped name", () => {
    const xml = buildProfilerConfiguration({
      assemblyId: "11111111-1111-1111-1111-111111111111",
      typeName: "T",
      stepId: "22222222-2222-2222-2222-222222222222",
      originalEventHandlerName: "A & B <step>",
    });
    expect(parseProfilerConfiguration(xml).originalEventHandlerName).toBe("A & B <step>");
  });

  it("takes the EventHandler id, not the AssemblyId", () => {
    expect(parseProfilerConfiguration(GOLDEN).stepId).not.toBe("11111111-1111-1111-1111-111111111111");
  });

  it("is empty for missing or unreadable configuration", () => {
    expect(parseProfilerConfiguration(undefined)).toEqual({});
    expect(parseProfilerConfiguration("")).toEqual({});
    expect(parseProfilerConfiguration("<Configuration/>")).toEqual({ stepId: undefined, originalEventHandlerName: undefined });
  });
});

describe("buildProfilerStepPayload", () => {
  const original = {
    name: "My step: Create of account",
    stage: 40,
    mode: 0,
    rank: 1,
    supporteddeployment: 0,
    asyncautodelete: false,
    category: null,
    invocationsource: 0,
    _sdkmessageid_value: "33333333-3333-3333-3333-333333333333",
    _sdkmessagefilterid_value: "44444444-4444-4444-4444-444444444444",
  };

  it("repoints the event handler at the profiler and carries the pipeline fields across", () => {
    const payload = buildProfilerStepPayload({ original, profilerPluginTypeId: "55555555-5555-5555-5555-555555555555", configuration: "<Configuration/>" });
    expect(payload["eventhandler_plugintype@odata.bind"]).toBe("/plugintypes(55555555-5555-5555-5555-555555555555)");
    expect(payload["sdkmessageid@odata.bind"]).toBe("/sdkmessages(33333333-3333-3333-3333-333333333333)");
    expect(payload["sdkmessagefilterid@odata.bind"]).toBe("/sdkmessagefilters(44444444-4444-4444-4444-444444444444)");
    // Miss any of these and the clone registers at the wrong pipeline position and never fires.
    expect(payload.stage).toBe(40);
    expect(payload.mode).toBe(0);
    expect(payload.rank).toBe(1);
    expect(payload.supporteddeployment).toBe(0);
    expect(payload.asyncautodelete).toBe(false);
    expect(payload.name).toBe("My step: Create of account (Profiler)");
    expect(payload.description).toBe(PROFILER_STEP_DESCRIPTION);
    expect(payload.configuration).toBe("<Configuration/>");
  });

  it("omits a message filter when the message has none (binding null is a 400)", () => {
    const payload = buildProfilerStepPayload({
      original: { ...original, _sdkmessagefilterid_value: null },
      profilerPluginTypeId: "5".repeat(8) + "-5555-5555-5555-555555555555",
      configuration: "",
    });
    expect("sdkmessagefilterid@odata.bind" in payload).toBe(false);
  });

  it("omits category when the original has none, and copies it when it does", () => {
    expect("category" in buildProfilerStepPayload({ original, profilerPluginTypeId: "x", configuration: "" })).toBe(false);
    expect(buildProfilerStepPayload({ original: { ...original, category: "abc" }, profilerPluginTypeId: "x", configuration: "" }).category).toBe("abc");
  });

  it("falls back to a placeholder name for an unnamed step", () => {
    expect(buildProfilerStepPayload({ original: { ...original, name: undefined }, profilerPluginTypeId: "x", configuration: "" }).name).toBe("Unnamed plug-in (Profiler)");
  });
});

describe("queries and names", () => {
  it("finds the profiler's plug-in type by type AND assembly", () => {
    const query = profilerPluginTypeQuery();
    expect(query).toContain("typename eq 'PluginProfiler.Plugins.ProfilerPlugin'");
    expect(query).toContain("pluginassemblyid/name eq 'PluginProfiler.Plugins'");
  });

  it("selects every field the clone needs, plus the assembly the blob needs", () => {
    const query = stepToCloneQuery("66666666-6666-6666-6666-666666666666");
    for (const field of ["stage", "mode", "rank", "supporteddeployment", "asyncautodelete", "category", "statecode", "_sdkmessageid_value", "_sdkmessagefilterid_value"]) {
      expect(query).toContain(field);
    }
    expect(query).toContain("$expand=plugintypeid($select=typename,_pluginassemblyid_value)");
  });

  it("filters images by their parent step", () => {
    expect(stepImagesQuery("66666666-6666-6666-6666-666666666666")).toContain("_sdkmessageprocessingstepid_value eq 66666666-6666-6666-6666-666666666666");
  });

  it("names the clone and the original the way the profiler does", () => {
    expect(profilerCloneName("S")).toBe("S (Profiler)");
    expect(profiledOriginalName("S")).toBe("S (Profiled)");
  });

  it("uses concrete state/status pairs (the Web API rejects SetState's -1)", () => {
    expect(STEP_STATE_DISABLED).toEqual({ statecode: 1, statuscode: 2 });
    expect(STEP_STATE_ENABLED).toEqual({ statecode: 0, statuscode: 1 });
  });
});
