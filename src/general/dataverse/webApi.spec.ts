import { describe, it, expect, vi } from "vitest";
import { dataverseApiUrl, DATAVERSE_API_VERSION, logDataverseHttpError, logDataverseError } from "./webApi";

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
