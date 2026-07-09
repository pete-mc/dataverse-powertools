/* eslint-disable @typescript-eslint/naming-convention */ // Dataverse API response fields (LogicalName, msdyn_*) must match the API, not camelCase.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { getDataverseForms } from "./getDataverseForms";
import { fakeDataverseContext, okJson, httpError } from "../../../test/dataverseTestUtils";

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => fetchMock.mockReset());

describe("getDataverseForms", () => {
  it("queries solutioncomponentsummaries filtered by entity and maps records", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ msdyn_objectid: "id-1", msdyn_name: "Main", msdyn_componenttypename: "Main Form" }] }));
    const { context } = fakeDataverseContext();
    const forms = await getDataverseForms(context, "account");
    expect(forms).toEqual([{ formId: "id-1", displayName: "Main", formType: "Main Form" }]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/data/v9.2/msdyn_solutioncomponentsummaries");
    expect(url).toContain("msdyn_primaryentityname%20eq%20%27account%27");
  });

  it("initialises the connection first when the context is not yet valid", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [] }));
    const { context } = fakeDataverseContext({ isValid: false });
    await getDataverseForms(context, "contact");
    expect(context.dataverse.initialize).toHaveBeenCalledOnce();
  });

  it("returns [] without calling fetch when initialise fails", async () => {
    const { context } = fakeDataverseContext({ isValid: false });
    context.dataverse.initialize = vi.fn(async () => false);
    expect(await getDataverseForms(context, "account")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns [] and logs on a non-OK response", async () => {
    fetchMock.mockResolvedValue(httpError(404, "Not Found"));
    const { context, lines } = fakeDataverseContext();
    expect(await getDataverseForms(context, "account")).toEqual([]);
    expect(lines.join("\n")).toContain("Failed to load forms for 'account': 404 Not Found");
  });
});
