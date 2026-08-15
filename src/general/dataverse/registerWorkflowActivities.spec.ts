import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { registerWorkflowActivities } from "./registerWorkflowActivities";
import { WorkflowActivityRegistration } from "./stepPayloads";
import { fakeDataverseContext, okJson } from "../../../test/dataverseTestUtils";

// #143 Move 2 — verify the workflow-activity registration orchestration (plugin
// Build & Deploy) against a mocked Web API: unchanged / update / skip.

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => fetchMock.mockReset());

function noContent() {
  return { ok: true, status: 204, statusText: "", headers: { get: () => null }, json: async () => ({}), text: async () => "" };
}

const workflow: WorkflowActivityRegistration = {
  className: "MyActivity",
  fullTypeName: "NS.MyActivity",
  workflowName: "My Activity",
  workflowDescription: "desc",
  workflowGroup: "Grp",
};

/** A plugintype record that matches `workflow` exactly (→ unchanged). */
const matchingRecord = {
  plugintypeid: "pt-1",
  typename: "NS.MyActivity",
  name: "My Activity",
  friendlyname: "My Activity",
  description: "desc",
  workflowactivitygroupname: "Grp",
};

function route(records: unknown[]) {
  fetchMock.mockImplementation((url: string, opts: { method?: string } = {}) => {
    const method = opts.method ?? "GET";
    if (method === "GET" && String(url).includes("plugintypes")) {
      return Promise.resolve(okJson({ value: records }));
    }
    return Promise.resolve(noContent()); // PATCH
  });
}

function methodCalls(method: string, urlPart: string): number {
  return fetchMock.mock.calls.filter((c) => (c[1]?.method ?? "GET") === method && String(c[0]).includes(urlPart)).length;
}

describe("registerWorkflowActivities — orchestration vs mocked Web API (#143 Move 2)", () => {
  it("leaves a matching workflow activity unchanged (no PATCH)", async () => {
    route([matchingRecord]);
    const { context } = fakeDataverseContext();
    const result = await registerWorkflowActivities(context, "asm-1", [workflow]);
    expect(result).toMatchObject({ unchanged: 1, updated: 0, skipped: 0 });
    expect(methodCalls("PATCH", "plugintypes(pt-1)")).toBe(0);
  });

  it("PATCHes a workflow activity whose metadata differs", async () => {
    route([{ ...matchingRecord, description: "old description" }]);
    const { context } = fakeDataverseContext();
    const result = await registerWorkflowActivities(context, "asm-1", [workflow]);
    expect(result).toMatchObject({ updated: 1, unchanged: 0 });
    expect(methodCalls("PATCH", "plugintypes(pt-1)")).toBe(1);
  });

  it("skips a workflow activity whose plugin type isn't in the assembly", async () => {
    route([]);
    const { context } = fakeDataverseContext();
    const result = await registerWorkflowActivities(context, "asm-1", [workflow]);
    expect(result).toMatchObject({ skipped: 1, updated: 0 });
    expect(methodCalls("PATCH", "plugintypes")).toBe(0);
  });

  // The solution association is what makes a registered activity actually ship: an activity that
  // exists in the environment but is in no solution is invisible to an export, so the next
  // deployment to another environment silently lacks it.
  it("associates the activity with the solution as component type 90", async () => {
    route([matchingRecord]);
    const { context } = fakeDataverseContext();
    await registerWorkflowActivities(context, "asm-1", [workflow], "PowerToolsDev");

    const addCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("AddSolutionComponent"));
    expect(addCalls, "AddSolutionComponent should be called once").toHaveLength(1);
    const body = JSON.parse(String(addCalls[0][1]?.body));
    expect(body.ComponentType).toBe(90);
    expect(body.ComponentId).toBe("pt-1");
    expect(body.SolutionUniqueName).toBe("PowerToolsDev");
  });

  it("associates an activity it did not have to change — unchanged still means present", async () => {
    route([matchingRecord]);
    const { context } = fakeDataverseContext();
    const result = await registerWorkflowActivities(context, "asm-1", [workflow], "PowerToolsDev");
    expect(result).toMatchObject({ unchanged: 1 });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("AddSolutionComponent"))).toBe(true);
  });

  it("does not associate with the solution when no solution was given", async () => {
    route([matchingRecord]);
    const { context } = fakeDataverseContext();
    await registerWorkflowActivities(context, "asm-1", [workflow]);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("AddSolutionComponent"))).toBe(false);
  });

  // A failed PATCH means the activity's metadata is wrong in the environment. Adding it to the
  // solution anyway would ship that wrong metadata onward as though it were intended.
  it("does not associate an activity whose metadata update failed", async () => {
    fetchMock.mockImplementation((url: string, opts: { method?: string } = {}) => {
      const method = opts.method ?? "GET";
      if (method === "GET" && String(url).includes("plugintypes")) {
        return Promise.resolve(okJson({ value: [{ ...matchingRecord, description: "old description" }] }));
      }
      if (method === "PATCH") {
        return Promise.resolve({ ok: false, status: 400, statusText: "Bad Request", headers: { get: () => null }, json: async () => ({}), text: async () => "boom" });
      }
      return Promise.resolve(noContent());
    });
    const { context } = fakeDataverseContext();
    const result = await registerWorkflowActivities(context, "asm-1", [workflow], "PowerToolsDev");
    expect(result).toMatchObject({ skipped: 1, updated: 0 });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("AddSolutionComponent"))).toBe(false);
  });

  it("tallies a mixed batch rather than stopping at the first skip", async () => {
    const missing: WorkflowActivityRegistration = { ...workflow, className: "OtherActivity", fullTypeName: "NS.OtherActivity", workflowName: "Other Activity" };
    // Filter-aware: the by-type lookup for the missing activity must come back EMPTY. (Answering
    // every plugintypes query with the same record would let the direct lookup "find" a type that
    // isn't there, and this test would pass while proving nothing.)
    fetchMock.mockImplementation((url: string, opts: { method?: string } = {}) => {
      const method = opts.method ?? "GET";
      if (method === "GET" && String(url).includes("plugintypes")) {
        return Promise.resolve(okJson({ value: String(url).includes("OtherActivity") ? [] : [matchingRecord] }));
      }
      return Promise.resolve(noContent());
    });
    const { context } = fakeDataverseContext();
    const result = await registerWorkflowActivities(context, "asm-1", [missing, workflow]);
    expect(result).toMatchObject({ unchanged: 1, skipped: 1, updated: 0 });
  });
});
