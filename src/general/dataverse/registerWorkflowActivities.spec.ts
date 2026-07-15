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
});
