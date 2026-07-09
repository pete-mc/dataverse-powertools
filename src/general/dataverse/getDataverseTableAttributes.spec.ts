/* eslint-disable @typescript-eslint/naming-convention */ // Dataverse API response fields (LogicalName) must match the API, not camelCase.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { getDataverseTableAttributes } from "./getDataverseTableAttributes";
import { fakeDataverseContext, okJson, httpError } from "../../../test/dataverseTestUtils";

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => fetchMock.mockReset());

describe("getDataverseTableAttributes", () => {
  it("queries the entity's attributes and returns logical names sorted", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ LogicalName: "name" }, { LogicalName: "accountid" }, { LogicalName: "  " }] }));
    const { context } = fakeDataverseContext();
    const result = await getDataverseTableAttributes(context, "account");
    expect(result).toEqual(["accountid", "name"]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/data/v9.2/EntityDefinitions(LogicalName='account')/Attributes");
    expect(url).toContain("AttributeOf eq null");
  });

  it("escapes single quotes in the table name to avoid breaking the OData filter", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [] }));
    const { context } = fakeDataverseContext();
    await getDataverseTableAttributes(context, "o'brien");
    expect(fetchMock.mock.calls[0][0]).toContain("LogicalName='o''brien'");
  });

  it("returns [] without calling fetch when there is no access token", async () => {
    const { context } = fakeDataverseContext();
    context.dataverse.getAuthorizationToken = vi.fn(async () => "");
    expect(await getDataverseTableAttributes(context, "account")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns [] when the response has no value array", async () => {
    fetchMock.mockResolvedValue(okJson({ notValue: true }));
    const { context } = fakeDataverseContext();
    expect(await getDataverseTableAttributes(context, "account")).toEqual([]);
  });

  it("returns [] and logs on a non-OK response", async () => {
    fetchMock.mockResolvedValue(httpError(403, "Forbidden"));
    const { context, lines } = fakeDataverseContext();
    expect(await getDataverseTableAttributes(context, "account")).toEqual([]);
    expect(lines.join("\n")).toContain("Failed to load attributes for table 'account': 403 Forbidden");
  });
});
