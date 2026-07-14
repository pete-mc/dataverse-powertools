import { describe, it, expect } from "vitest";
import { parseProfilableSteps, profilableStepsDiagnostics } from "./pluginProfiles";

/* eslint-disable @typescript-eslint/naming-convention -- Dataverse OData navigation/field names */

// The pure shape+filter behind getProfilableSteps — the code path behind #135
// ("No registered plugin steps to profile" for a step that IS registered). Extracted
// from the HTTP handler so the filtering is unit-testable without a live org
// (mocking node-fetch v3 / ESM in vitest is a separate config concern, see #143).

const validRow = {
  sdkmessageprocessingstepid: "step-1",
  name: "My.Plugins.AccountCreate: Create of account",
  mode: 0,
  statecode: 0,
  sdkmessageid: { name: "Create" },
  sdkmessagefilterid: { primaryobjecttypecode: "account" },
  eventhandler_plugintype: { typename: "My.Plugins.AccountCreate", pluginassemblyid: { name: "MyPlugins" } },
};

describe("parseProfilableSteps", () => {
  it("shapes a registered step from the expand, enriched with message + entity", () => {
    expect(parseProfilableSteps({ value: [validRow] })).toEqual([
      { stepId: "step-1", name: "My.Plugins.AccountCreate: Create of account", typeName: "My.Plugins.AccountCreate", message: "Create", primaryEntity: "account", mode: 0 },
    ]);
  });

  it("scopes to the requested assembly when given", () => {
    const other = { ...validRow, sdkmessageprocessingstepid: "step-2", eventhandler_plugintype: { typename: "Other.Plugin", pluginassemblyid: { name: "OtherAsm" } } };
    expect(parseProfilableSteps({ value: [validRow, other] }, "MyPlugins").map((s) => s.stepId)).toEqual(["step-1"]);
    expect(parseProfilableSteps({ value: [validRow, other] }, "OtherAsm").map((s) => s.stepId)).toEqual(["step-2"]);
    // No assembly filter → both.
    expect(parseProfilableSteps({ value: [validRow, other] }).map((s) => s.stepId)).toEqual(["step-1", "step-2"]);
  });

  it("drops system (Microsoft.*) steps and the profiler's own (Profiled) clones", () => {
    const microsoft = { ...validRow, sdkmessageprocessingstepid: "ms", eventhandler_plugintype: { typename: "Microsoft.Crm.X", pluginassemblyid: { name: "Microsoft" } } };
    const profiled = { ...validRow, sdkmessageprocessingstepid: "prof", name: "My.Plugins.AccountCreate (Profiled): Create of account" };
    expect(parseProfilableSteps({ value: [validRow, microsoft, profiled] }).map((s) => s.stepId)).toEqual(["step-1"]);
  });

  it("#135 characterisation: a step whose plugintype expand didn't populate is dropped (typeName empty)", () => {
    // The suspected #135 failure mode: eventhandler_plugintype comes back null for a real,
    // active step, so typeName is "" and the `step.typeName && …` filter drops it — the
    // handler then reports "No registered plugin steps to profile". This pins that
    // behaviour; when #135 is diagnosed (resolve the type a different way), update it here.
    expect(parseProfilableSteps({ value: [{ ...validRow, eventhandler_plugintype: null }] })).toEqual([]);
    expect(parseProfilableSteps({ value: [{ ...validRow, eventhandler_plugintype: { pluginassemblyid: { name: "MyPlugins" } } }] })).toEqual([]);
  });

  it("tolerates a missing/empty result set and missing optional expands", () => {
    expect(parseProfilableSteps({ value: [] })).toEqual([]);
    expect(parseProfilableSteps({})).toEqual([]);
    expect(parseProfilableSteps(undefined)).toEqual([]);
    // message/primaryEntity are optional — a step with no filter/message still shapes.
    const minimal = { sdkmessageprocessingstepid: "m", name: "n", eventhandler_plugintype: { typename: "A.B", pluginassemblyid: { name: "Asm" } } };
    expect(parseProfilableSteps({ value: [minimal] })).toEqual([{ stepId: "m", name: "n", typeName: "A.B", message: undefined, primaryEntity: undefined, mode: undefined }]);
  });
});

describe("profilableStepsDiagnostics (#135 — explain an empty result)", () => {
  it("counts each drop reason so a 'no steps' outcome is diagnosable", () => {
    const microsoft = { ...validRow, sdkmessageprocessingstepid: "ms", eventhandler_plugintype: { typename: "Microsoft.Crm.X", pluginassemblyid: { name: "Microsoft" } } };
    const profiled = { ...validRow, sdkmessageprocessingstepid: "prof", name: "My.Plugins.AccountCreate (Profiled): Create of account" };
    const noType = { ...validRow, sdkmessageprocessingstepid: "nt", eventhandler_plugintype: null };
    const diag = profilableStepsDiagnostics({ value: [validRow, microsoft, profiled, noType] });
    expect(diag).toEqual({ total: 4, kept: 1, droppedNoType: 1, droppedSystem: 1, droppedProfiled: 1, droppedByAssembly: 0 });
  });

  it("attributes the whole result to the empty-plugintype bucket when that's the cause", () => {
    const noType = { ...validRow, eventhandler_plugintype: null };
    const diag = profilableStepsDiagnostics({ value: [noType] });
    expect(diag).toEqual({ total: 1, kept: 0, droppedNoType: 1, droppedSystem: 0, droppedProfiled: 0, droppedByAssembly: 0 });
  });

  it("counts assembly-scoped drops", () => {
    const other = { ...validRow, sdkmessageprocessingstepid: "o", eventhandler_plugintype: { typename: "Other.Plugin", pluginassemblyid: { name: "OtherAsm" } } };
    expect(profilableStepsDiagnostics({ value: [validRow, other] }, "MyPlugins")).toMatchObject({ total: 2, kept: 1, droppedByAssembly: 1 });
  });
});
