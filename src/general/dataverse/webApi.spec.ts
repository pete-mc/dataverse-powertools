import { describe, it, expect, vi } from "vitest";
import { dataverseApiUrl, DATAVERSE_API_VERSION, logDataverseHttpError, logDataverseError, entityIdFromODataHeader } from "./webApi";

function fakeChannel() {
  return { appendLine: vi.fn(), show: vi.fn() };
}

describe("dataverseApiUrl", () => {
  it("joins the org url and resource with the configured api version", () => {
    expect(dataverseApiUrl("https://org.crm.dynamics.com", "WhoAmI")).toBe(`https://org.crm.dynamics.com/api/data/${DATAVERSE_API_VERSION}/WhoAmI`);
  });

  it("tolerates trailing/leading slashes on either part", () => {
    expect(dataverseApiUrl("https://org.crm.dynamics.com/", "/webresourceset")).toBe(`https://org.crm.dynamics.com/api/data/${DATAVERSE_API_VERSION}/webresourceset`);
  });

  it("keeps query strings intact", () => {
    expect(dataverseApiUrl("https://org.crm.dynamics.com", "solutions?$select=solutionid")).toBe(
      `https://org.crm.dynamics.com/api/data/${DATAVERSE_API_VERSION}/solutions?$select=solutionid`,
    );
  });

  it("handles a missing org url", () => {
    expect(dataverseApiUrl(undefined, "WhoAmI")).toBe(`/api/data/${DATAVERSE_API_VERSION}/WhoAmI`);
  });
});

describe("logDataverseHttpError", () => {
  it("logs the operation, status line, and body, and surfaces the channel", async () => {
    const channel = fakeChannel();
    const body = await logDataverseHttpError(channel, "load tables", {
      status: 401,
      statusText: "Unauthorized",
      text: async () => "token expired",
    });
    expect(body).toBe("token expired");
    expect(channel.appendLine).toHaveBeenCalledWith("Failed to load tables: 401 Unauthorized — token expired");
    expect(channel.show).toHaveBeenCalled();
  });

  it("omits the body separator when the response body is empty", async () => {
    const channel = fakeChannel();
    await logDataverseHttpError(channel, "load messages", { status: 500, statusText: "", text: async () => "" });
    expect(channel.appendLine).toHaveBeenCalledWith("Failed to load messages: 500");
  });

  it("still logs when reading the body throws", async () => {
    const channel = fakeChannel();
    await logDataverseHttpError(channel, "load forms", {
      status: 502,
      statusText: "Bad Gateway",
      text: async () => {
        throw new Error("stream closed");
      },
    });
    expect(channel.appendLine).toHaveBeenCalledWith("Failed to load forms: 502 Bad Gateway");
  });
});

describe("logDataverseError", () => {
  it("logs an Error message with context and surfaces the channel", () => {
    const channel = fakeChannel();
    logDataverseError(channel, "load solutions", new Error("network down"));
    expect(channel.appendLine).toHaveBeenCalledWith("Error while trying to load solutions: network down");
    expect(channel.show).toHaveBeenCalled();
  });

  it("stringifies non-Error throwables", () => {
    const channel = fakeChannel();
    logDataverseError(channel, "load attributes", { code: 42 });
    expect(channel.appendLine).toHaveBeenCalledWith('Error while trying to load attributes: {"code":42}');
  });
});

// A Dataverse CREATE answers 204 No Content with the new id in this header. Reading it is what keeps a
// first-time plug-in step registration working: `.json()` on that empty body threw "Unexpected end of
// JSON input" and failed the whole Build & deploy, and returning {} instead would have silently stopped
// the new step being added to the solution.
describe("entityIdFromODataHeader", () => {
  it("reads the id out of the URI Dataverse sends", () => {
    expect(entityIdFromODataHeader("https://org.crm.dynamics.com/api/data/v9.2/sdkmessageprocessingsteps(6b29fc40-ca47-1067-b31d-00dd010662da)")).toBe(
      "6b29fc40-ca47-1067-b31d-00dd010662da",
    );
  });

  it("tolerates a trailing slash and surrounding whitespace", () => {
    expect(entityIdFromODataHeader("  https://org.crm.dynamics.com/api/data/v9.2/plugintypes(6b29fc40-ca47-1067-b31d-00dd010662da)/  ")).toBe(
      "6b29fc40-ca47-1067-b31d-00dd010662da",
    );
  });

  it("returns undefined when the header is absent or unparseable", () => {
    expect(entityIdFromODataHeader(null)).toBeUndefined();
    expect(entityIdFromODataHeader(undefined)).toBeUndefined();
    expect(entityIdFromODataHeader("")).toBeUndefined();
    expect(entityIdFromODataHeader("https://org.crm.dynamics.com/api/data/v9.2/accounts")).toBeUndefined();
    expect(entityIdFromODataHeader("accounts(not-a-guid)")).toBeUndefined();
  });

  it("takes the LAST parenthesised guid, not one earlier in the path", () => {
    expect(entityIdFromODataHeader("https://o/api/data/v9.2/a(11111111-1111-1111-1111-111111111111)/b(6b29fc40-ca47-1067-b31d-00dd010662da)")).toBe(
      "6b29fc40-ca47-1067-b31d-00dd010662da",
    );
  });
});
