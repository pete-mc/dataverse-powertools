/* eslint-disable @typescript-eslint/naming-convention -- AddSolutionComponent action params are PascalCase */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { addDataverseSolutionComponent, addDataverseSolutionComponentByObjectId } from "./addDataverseSolutionComponent";
import { fakeDataverseContext, okJson, httpError } from "../../../test/dataverseTestUtils";

// #143 Move 2 — AddSolutionComponent path against a mocked node-fetch, no live org. Guards the
// success + the "already in this solution" idempotency branch (a non-OK response that must still
// be treated as success), and the resolve-type-then-add composition.

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => fetchMock.mockReset());

describe("addDataverseSolutionComponent", () => {
  it("POSTs AddSolutionComponent and returns true on success", async () => {
    fetchMock.mockResolvedValue(okJson({}));
    const { context } = fakeDataverseContext();
    expect(await addDataverseSolutionComponent(context, "mysolution", 61, "comp-1")).toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("AddSolutionComponent");
    expect(JSON.parse((options as any).body)).toMatchObject({ ComponentId: "comp-1", ComponentType: 61, SolutionUniqueName: "mysolution" });
  });

  it("treats an 'already in this solution' error as success (idempotent re-run)", async () => {
    fetchMock.mockResolvedValue(httpError(400, "Bad Request", "Component is already in this solution."));
    const { context } = fakeDataverseContext();
    expect(await addDataverseSolutionComponent(context, "mysolution", 61, "comp-1")).toBe(true);
  });

  it("returns false and logs on a genuine failure", async () => {
    fetchMock.mockResolvedValue(httpError(403, "Forbidden", "privilege missing"));
    const { context, lines } = fakeDataverseContext();
    expect(await addDataverseSolutionComponent(context, "mysolution", 61, "comp-1")).toBe(false);
    expect(lines.join("\n")).toContain("Failed to add component to solution 'mysolution'");
  });

  it("returns false without a network call when the solution name is empty", async () => {
    const { context } = fakeDataverseContext();
    expect(await addDataverseSolutionComponent(context, "", 61, "comp-1")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("addDataverseSolutionComponentByObjectId", () => {
  it("resolves the component type by object id, then adds it", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ componenttype: 80, objectid: "obj-1" }] })); // resolve type
    fetchMock.mockResolvedValueOnce(okJson({})); // AddSolutionComponent
    const { context } = fakeDataverseContext();
    expect(await addDataverseSolutionComponentByObjectId(context, "mysolution", "obj-1")).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain("solutioncomponents?");
    expect(JSON.parse((fetchMock.mock.calls[1][1] as any).body)).toMatchObject({ ComponentType: 80, ComponentId: "obj-1" });
  });

  it("returns false (no add) when the component type can't be resolved", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [] })); // resolve type → none
    const { context, lines } = fakeDataverseContext();
    expect(await addDataverseSolutionComponentByObjectId(context, "mysolution", "obj-1")).toBe(false);
    expect(lines.join("\n")).toContain("Could not resolve solution component type");
    expect(fetchMock).toHaveBeenCalledOnce(); // only the resolve, no add
  });
});
