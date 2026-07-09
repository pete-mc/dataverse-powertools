/* eslint-disable @typescript-eslint/naming-convention */ // Dataverse API response fields (LogicalName, msdyn_*) must match the API, not camelCase.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { getDataverseTables } from "./getDataverseTables";
import { fakeDataverseContext, okJson, httpError } from "../../../test/dataverseTestUtils";

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => fetchMock.mockReset());

describe("getDataverseTables", () => {
  it("requests EntityDefinitions on the v9.2 API and returns trimmed logical names", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ LogicalName: "account" }, { LogicalName: " contact " }] }));
    const { context } = fakeDataverseContext({ organizationUrl: "https://org.crm.dynamics.com/" });
    const result = await getDataverseTables(context);
    expect(result).toEqual(["account", "contact"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://org.crm.dynamics.com/api/data/v9.2/EntityDefinitions?$select=LogicalName");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("drops empty, whitespace-only, and missing logical names", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ LogicalName: "account" }, { LogicalName: "" }, { LogicalName: "   " }, {}] }));
    const { context } = fakeDataverseContext();
    expect(await getDataverseTables(context)).toEqual(["account"]);
  });

  it("returns [] and logs a consistent error on a non-OK response", async () => {
    fetchMock.mockResolvedValue(httpError(401, "Unauthorized", "expired token"));
    const { context, lines } = fakeDataverseContext();
    expect(await getDataverseTables(context)).toEqual([]);
    expect(lines.join("\n")).toContain("Failed to load tables: 401 Unauthorized — expired token");
  });

  it("returns [] and logs when the call fails (unparseable body)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("ECONNRESET");
      },
    });
    const { context, lines } = fakeDataverseContext();
    expect(await getDataverseTables(context)).toEqual([]);
    expect(lines.join("\n")).toContain("Error while trying to load tables: ECONNRESET");
  });
});
