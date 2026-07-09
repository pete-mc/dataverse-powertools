/* eslint-disable @typescript-eslint/naming-convention */ // Dataverse API response fields (name/Name) must match the API, not camelCase.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { getDataverseMessages } from "./getDataverseMessages";
import { fakeDataverseContext, okJson, httpError } from "../../../test/dataverseTestUtils";

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => fetchMock.mockReset());

describe("getDataverseMessages", () => {
  it("requests non-private sdkmessages and returns names sorted ascending", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ name: "Update" }, { name: "Create" }, { name: "Delete" }] }));
    const { context } = fakeDataverseContext();
    const result = await getDataverseMessages(context);
    expect(result).toEqual(["Create", "Delete", "Update"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://org.crm.dynamics.com/api/data/v9.2/sdkmessages?$select=name&$filter=isprivate eq false");
  });

  it("accepts either name or Name casing and drops blanks", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ Name: "Assign" }, { name: " " }, { name: "Book" }, {}] }));
    const { context } = fakeDataverseContext();
    expect(await getDataverseMessages(context)).toEqual(["Assign", "Book"]);
  });

  it("returns [] and logs when the call fails (unparseable body)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("network down");
      },
    });
    const { context, lines } = fakeDataverseContext();
    expect(await getDataverseMessages(context)).toEqual([]);
    expect(lines.join("\n")).toContain("Error while trying to load messages: network down");
  });

  it("returns [] on a non-OK response", async () => {
    fetchMock.mockResolvedValue(httpError(500, "Server Error"));
    const { context } = fakeDataverseContext();
    expect(await getDataverseMessages(context)).toEqual([]);
  });
});
