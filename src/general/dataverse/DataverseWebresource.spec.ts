import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { DataverseWebresource } from "./DataverseWebresource";
import { fakeDataverseContext, okJson, httpError } from "../../../test/dataverseTestUtils";

// #143 Move 2 — the WEBRESOURCE deploy path (lookup → create/update → add-to-solution) against a
// mocked node-fetch, no live org. This flow is proven ~6× in the e2e tier but had zero unit coverage;
// this guards the id-driven create-vs-update branch and the "already in solution" idempotency.

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => fetchMock.mockReset());

describe("DataverseWebresource.mapWebresourceType", () => {
  it("maps common extensions and returns undefined for unknown ones", () => {
    expect(DataverseWebresource.mapWebresourceType(".js")).toBe(3);
    expect(DataverseWebresource.mapWebresourceType(".css")).toBe(2);
    expect(DataverseWebresource.mapWebresourceType(".html")).toBe(1);
    expect(DataverseWebresource.mapWebresourceType(".png")).toBe(5);
    expect(DataverseWebresource.mapWebresourceType(".svg")).toBe(11);
    expect(DataverseWebresource.mapWebresourceType(".exe")).toBeUndefined();
  });
});

describe("DataverseWebresource.load", () => {
  it("resolves the webresource id by name (OData-escaped)", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ webresourceid: "wr-1", name: "new_script.js" }] }));
    const { context } = fakeDataverseContext();
    const wr = new DataverseWebresource("o'reilly.js", context);
    await wr.load();
    expect(wr.id).toBe("wr-1");
    expect(fetchMock.mock.calls[0][0]).toContain("o''reilly.js"); // single quote doubled
  });

  it("leaves id undefined (no throw) when there's no match", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [] }));
    const { context } = fakeDataverseContext();
    const wr = new DataverseWebresource("new_script.js", context);
    await wr.load();
    expect(wr.id).toBeUndefined();
  });

  it("throws on a non-OK lookup", async () => {
    fetchMock.mockResolvedValue(httpError(500, "Server Error", "boom"));
    const { context } = fakeDataverseContext();
    await expect(new DataverseWebresource("new_script.js", context).load()).rejects.toThrow(/Failed to lookup webresource/);
  });

  it("does not call the network when the connection is invalid", async () => {
    const { context } = fakeDataverseContext({ isValid: false });
    await new DataverseWebresource("new_script.js", context).load();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DataverseWebresource.upsert", () => {
  it("CREATES (POST webresourceset) when the resource doesn't exist", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [] })); // internal load: none
    fetchMock.mockResolvedValueOnce(okJson({})); // POST create
    const { context } = fakeDataverseContext();
    await new DataverseWebresource("new_script.js", context).upsert("QkFTRTY0", 3);
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toMatch(/webresourceset$/);
    expect(options).toMatchObject({ method: "POST" });
    expect(JSON.parse((options as any).body)).toMatchObject({ name: "new_script.js", webresourcetype: 3, content: "QkFTRTY0" });
  });

  it("UPDATES (PATCH webresourceset(id)) when the resource exists", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ webresourceid: "wr-1" }] })); // internal load: found
    fetchMock.mockResolvedValueOnce(okJson({})); // PATCH update
    const { context } = fakeDataverseContext();
    await new DataverseWebresource("new_script.js", context).upsert("QkFTRTY0", 3);
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toContain("webresourceset(wr-1)");
    expect(options).toMatchObject({ method: "PATCH" });
  });
});

describe("DataverseWebresource.addToSolution", () => {
  it("adds the resource to the solution once its id resolves", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ webresourceid: "wr-1" }] })); // load
    fetchMock.mockResolvedValueOnce(okJson({})); // AddSolutionComponent
    const { context, lines } = fakeDataverseContext();
    await new DataverseWebresource("new_script.js", context).addToSolution("mysolution");
    expect(fetchMock.mock.calls[1][0]).toContain("AddSolutionComponent");
    expect(lines.join("\n")).toContain("Added webresource 'new_script.js' to solution 'mysolution'");
  });

  it("treats 'already in this solution' as success (no throw)", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ webresourceid: "wr-1" }] })); // load
    fetchMock.mockResolvedValueOnce(httpError(400, "Bad Request", "already a member of this solution")); // add
    const { context } = fakeDataverseContext();
    await expect(new DataverseWebresource("new_script.js", context).addToSolution("mysolution")).resolves.toBeUndefined();
  });

  it("skips (logs) when the webresource id can't be resolved", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [] })); // load: none
    const { context, lines } = fakeDataverseContext();
    await new DataverseWebresource("new_script.js", context).addToSolution("mysolution");
    expect(fetchMock).toHaveBeenCalledOnce(); // only the load, no AddSolutionComponent
    expect(lines.join("\n")).toContain("Unable to resolve webresource id");
  });
});
