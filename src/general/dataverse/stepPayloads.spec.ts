import { describe, it, expect } from "vitest";
import {
  normalizeFilteringAttributes,
  stepNeedsUpdate,
  buildStepPayload,
  normalizeString,
  normalizeForCompare,
  toResolvedWorkflowPluginType,
  getWorkflowPatchPayload,
  PluginStepRegistration,
  ExistingStepSnapshot,
  WorkflowActivityRegistration,
} from "./stepPayloads";

function step(overrides: Partial<PluginStepRegistration> = {}): PluginStepRegistration {
  return {
    className: "MyPlugin",
    fullTypeName: "My.NS.MyPlugin",
    messageName: "Update",
    entityLogicalName: "account",
    stage: 40,
    mode: 0,
    filteringAttributes: "name,telephone1",
    stepName: "My.NS.MyPlugin: Update of account",
    executionOrder: 1,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingStepSnapshot> = {}): ExistingStepSnapshot {
  return {
    sdkmessageprocessingstepid: "step-1",
    name: "My.NS.MyPlugin: Update of account",
    rank: 1,
    stage: 40,
    mode: 0,
    filteringattributes: "name,telephone1",
    sdkMessageFilterId: undefined,
    ...overrides,
  };
}

describe("normalizeFilteringAttributes", () => {
  it("trims, lower-cases, drops empties, and sorts", () => {
    expect(normalizeFilteringAttributes(" Name , TELEPHONE1 ,,")).toBe("name,telephone1");
  });

  it("is order-insensitive (same set → same string)", () => {
    expect(normalizeFilteringAttributes("b,a,c")).toBe(normalizeFilteringAttributes("c,a,b"));
  });

  it("returns empty string for undefined / empty", () => {
    expect(normalizeFilteringAttributes(undefined)).toBe("");
    expect(normalizeFilteringAttributes("")).toBe("");
    expect(normalizeFilteringAttributes(" , , ")).toBe("");
  });
});

describe("stepNeedsUpdate", () => {
  it("is false when everything matches (including reordered filters)", () => {
    expect(stepNeedsUpdate(existing({ filteringattributes: "telephone1,name" }), step())).toBe(false);
  });

  it.each([
    ["name", { name: "different name" }],
    ["rank", { rank: 99 }],
    ["stage", { stage: 20 }],
    ["mode", { mode: 1 }],
    ["filteringattributes", { filteringattributes: "name" }],
  ])("is true when %s differs", (_label, overrides) => {
    expect(stepNeedsUpdate(existing(overrides as Partial<ExistingStepSnapshot>), step())).toBe(true);
  });

  it("treats missing rank/stage/mode as 0", () => {
    expect(stepNeedsUpdate(existing({ rank: undefined, stage: undefined, mode: undefined }), step({ executionOrder: 0, stage: 0, mode: 0 }))).toBe(false);
  });

  it("detects a change in the sdk message filter id", () => {
    expect(stepNeedsUpdate(existing({ sdkMessageFilterId: undefined }), step(), "filter-2")).toBe(true);
    expect(stepNeedsUpdate(existing({ sdkMessageFilterId: "filter-2" }), step(), "filter-2")).toBe(false);
  });
});

describe("buildStepPayload", () => {
  it("builds the step body with the required @odata.bind navigations", () => {
    const payload = buildStepPayload(step(), "type-1", "msg-1");
    expect(payload).toMatchObject({
      name: "My.NS.MyPlugin: Update of account",
      rank: 1,
      stage: 40,
      mode: 0,
      supporteddeployment: 0,
      filteringattributes: "name,telephone1",
    });
    // Bracket access: the Dataverse nav-property keys aren't valid identifiers.
    expect(payload["plugintypeid@odata.bind"]).toBe("/plugintypes(type-1)");
    expect(payload["sdkmessageid@odata.bind"]).toBe("/sdkmessages(msg-1)");
  });

  it("omits the message-filter bind when no filter id is given", () => {
    expect(buildStepPayload(step(), "type-1", "msg-1")).not.toHaveProperty("sdkmessagefilterid@odata.bind");
  });

  it("adds the message-filter bind when a filter id is given", () => {
    expect(buildStepPayload(step(), "type-1", "msg-1", "filter-1")["sdkmessagefilterid@odata.bind"]).toBe("/sdkmessagefilters(filter-1)");
  });

  it("defaults filteringattributes to empty string", () => {
    expect(buildStepPayload(step({ filteringAttributes: undefined }), "t", "m").filteringattributes).toBe("");
  });
});

describe("normalizeString / normalizeForCompare", () => {
  it("normalizeString trims only", () => {
    expect(normalizeString("  Hi  ")).toBe("Hi");
    expect(normalizeString(undefined)).toBe("");
  });

  it("normalizeForCompare trims and lower-cases", () => {
    expect(normalizeForCompare("  Foo.Bar  ")).toBe("foo.bar");
    expect(normalizeForCompare(undefined)).toBe("");
  });
});

describe("toResolvedWorkflowPluginType", () => {
  it("returns undefined when there is no plugintypeid", () => {
    expect(toResolvedWorkflowPluginType(undefined)).toBeUndefined();
    expect(toResolvedWorkflowPluginType({})).toBeUndefined();
    expect(toResolvedWorkflowPluginType({ plugintypeid: "" })).toBeUndefined();
  });

  it("maps the record into id + snapshot", () => {
    expect(
      toResolvedWorkflowPluginType({
        plugintypeid: "pt-1",
        name: "My.Wf",
        friendlyname: "My Wf",
        description: "does things",
        workflowactivitygroupname: "MyGroup",
      }),
    ).toEqual({
      plugintypeid: "pt-1",
      snapshot: { name: "My.Wf", friendlyname: "My Wf", description: "does things", workflowactivitygroupname: "MyGroup" },
    });
  });
});

describe("getWorkflowPatchPayload", () => {
  const wf: WorkflowActivityRegistration = {
    className: "MyActivity",
    fullTypeName: "My.NS.MyActivity",
    workflowName: "My Activity",
    workflowDescription: "desc",
    workflowGroup: "Group",
  };

  it("is empty when nothing differs", () => {
    expect(getWorkflowPatchPayload({ name: "My Activity", friendlyname: "My Activity", description: "desc", workflowactivitygroupname: "Group" }, wf)).toEqual({});
  });

  it("includes only the fields that differ", () => {
    expect(getWorkflowPatchPayload({ name: "My Activity", friendlyname: "My Activity", description: "old", workflowactivitygroupname: "Group" }, wf)).toEqual({
      description: "desc",
    });
  });

  it("falls back to className when workflowName is blank", () => {
    const payload = getWorkflowPatchPayload({}, { ...wf, workflowName: "  ", workflowDescription: undefined, workflowGroup: undefined });
    expect(payload.name).toBe("MyActivity");
    expect(payload.friendlyname).toBe("MyActivity");
  });
});
