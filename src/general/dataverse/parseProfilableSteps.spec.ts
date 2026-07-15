import { describe, it, expect } from "vitest";
import { parseProfilableSteps, profilableStepsDiagnostics } from "./pluginProfiles";

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
  plugintypeid: { typename: "My.Plugins.AccountCreate", pluginassemblyid: { name: "MyPlugins" } },
};

describe("parseProfilableSteps", () => {
  it("shapes a registered step from the expand, enriched with message + entity", () => {
    expect(parseProfilableSteps({ value: [validRow] })).toEqual([
      { stepId: "step-1", name: "My.Plugins.AccountCreate: Create of account", typeName: "My.Plugins.AccountCreate", message: "Create", primaryEntity: "account", mode: 0 },
    ]);
  });

  it("scopes to the requested assembly when given", () => {
    const other = { ...validRow, sdkmessageprocessingstepid: "step-2", plugintypeid: { typename: "Other.Plugin", pluginassemblyid: { name: "OtherAsm" } } };
    expect(parseProfilableSteps({ value: [validRow, other] }, "MyPlugins").map((s) => s.stepId)).toEqual(["step-1"]);
    expect(parseProfilableSteps({ value: [validRow, other] }, "OtherAsm").map((s) => s.stepId)).toEqual(["step-2"]);
    // No assembly filter → both.
    expect(parseProfilableSteps({ value: [validRow, other] }).map((s) => s.stepId)).toEqual(["step-1", "step-2"]);
  });

  it("drops system (Microsoft.*) steps and the profiler's own (Profiled) clones", () => {
    const microsoft = { ...validRow, sdkmessageprocessingstepid: "ms", plugintypeid: { typename: "Microsoft.Crm.X", pluginassemblyid: { name: "Microsoft" } } };
    const profiled = { ...validRow, sdkmessageprocessingstepid: "prof", name: "My.Plugins.AccountCreate (Profiled): Create of account" };
    expect(parseProfilableSteps({ value: [validRow, microsoft, profiled] }).map((s) => s.stepId)).toEqual(["step-1"]);
  });

  it("#135: a row with no plugin type (null plugintypeid) is dropped — that's a webhook/service-endpoint step, not a plugin", () => {
    // #135 root cause + fix: the query now expands the dedicated `plugintypeid` lookup (was
    // the polymorphic `eventhandler_plugintype`, which didn't populate `typename` for normal
    // plugin steps → every row dropped). A null plugintypeid now legitimately means "not a
    // plugin step" (e.g. a webhook eventhandler), so dropping it is correct.
    expect(parseProfilableSteps({ value: [{ ...validRow, plugintypeid: null }] })).toEqual([]);
    expect(parseProfilableSteps({ value: [{ ...validRow, plugintypeid: { pluginassemblyid: { name: "MyPlugins" } } }] })).toEqual([]);
  });

  it("tolerates a missing/empty result set and missing optional expands", () => {
    expect(parseProfilableSteps({ value: [] })).toEqual([]);
    expect(parseProfilableSteps({})).toEqual([]);
    expect(parseProfilableSteps(undefined)).toEqual([]);
    // message/primaryEntity are optional — a step with no filter/message still shapes.
    const minimal = { sdkmessageprocessingstepid: "m", name: "n", plugintypeid: { typename: "A.B", pluginassemblyid: { name: "Asm" } } };
    expect(parseProfilableSteps({ value: [minimal] })).toEqual([{ stepId: "m", name: "n", typeName: "A.B", message: undefined, primaryEntity: undefined, mode: undefined }]);
  });
});

describe("profilableStepsDiagnostics (#135 — explain an empty result)", () => {
  it("counts each drop reason so a 'no steps' outcome is diagnosable", () => {
    const microsoft = { ...validRow, sdkmessageprocessingstepid: "ms", plugintypeid: { typename: "Microsoft.Crm.X", pluginassemblyid: { name: "Microsoft" } } };
    const profiled = { ...validRow, sdkmessageprocessingstepid: "prof", name: "My.Plugins.AccountCreate (Profiled): Create of account" };
    const noType = { ...validRow, sdkmessageprocessingstepid: "nt", plugintypeid: null };
    const diag = profilableStepsDiagnostics({ value: [validRow, microsoft, profiled, noType] });
    expect(diag).toEqual({ total: 4, kept: 1, droppedNoType: 1, droppedSystem: 1, droppedProfiled: 1, droppedByAssembly: 0 });
  });

  it("attributes the whole result to the empty-plugintype bucket when that's the cause", () => {
    const noType = { ...validRow, plugintypeid: null };
    const diag = profilableStepsDiagnostics({ value: [noType] });
    expect(diag).toEqual({ total: 1, kept: 0, droppedNoType: 1, droppedSystem: 0, droppedProfiled: 0, droppedByAssembly: 0 });
  });

  it("counts assembly-scoped drops", () => {
    const other = { ...validRow, sdkmessageprocessingstepid: "o", plugintypeid: { typename: "Other.Plugin", pluginassemblyid: { name: "OtherAsm" } } };
    expect(profilableStepsDiagnostics({ value: [validRow, other] }, "MyPlugins")).toMatchObject({ total: 2, kept: 1, droppedByAssembly: 1 });
  });
});
