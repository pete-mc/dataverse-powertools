import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { getSolutions } from "./getSolutions";
import { fakeDataverseContext, okJson, httpError } from "../../../test/dataverseTestUtils";

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => fetchMock.mockReset());

const sampleSolution = {
  solutionid: "sol-1",
  friendlyname: "Dataverse PowerTools Tests",
  uniquename: "dvpttests",
  publisherid: { friendlyname: "DVPT Publisher", customizationprefix: "dvpt", publisherid: "pub-1" },
};

describe("getSolutions", () => {
  it("requests unmanaged solutions with the publisher expanded and maps them", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [sampleSolution] }));
    const { context } = fakeDataverseContext();
    const solutions = await getSolutions(context);
    expect(solutions).toHaveLength(1);
    expect(solutions![0]).toMatchObject({
      id: "sol-1",
      displayName: "Dataverse PowerTools Tests",
      uniqueName: "dvpttests",
      publisherName: "DVPT Publisher",
      publisherPrefix: "dvpt",
      publisherId: "pub-1",
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/data/v9.2/solutions");
    expect(url).toContain("ismanaged%20eq%20false");
    expect(url).toContain("$expand=publisherid");
  });

  it("returns undefined on a non-OK response", async () => {
    fetchMock.mockResolvedValue(httpError(403, "Forbidden"));
    const { context } = fakeDataverseContext();
    expect(await getSolutions(context)).toBeUndefined();
  });

  it("returns undefined when the response shape is unexpected", async () => {
    fetchMock.mockResolvedValue(okJson({ notValue: [] }));
    const { context, lines } = fakeDataverseContext();
    expect(await getSolutions(context)).toBeUndefined();
    expect(lines.join("\n")).toContain("Unexpected solutions response");
  });

  it("initialises first when the context is not valid", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [] }));
    const { context } = fakeDataverseContext({ isValid: false });
    await getSolutions(context);
    expect(context.dataverse.initialize).toHaveBeenCalledOnce();
  });
});
