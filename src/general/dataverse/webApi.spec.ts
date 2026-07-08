import { describe, it, expect } from "vitest";
import { dataverseApiUrl, DATAVERSE_API_VERSION } from "./webApi";

describe("dataverseApiUrl", () => {
  it("joins the org url and resource with the configured api version", () => {
    expect(dataverseApiUrl("https://org.crm.dynamics.com", "WhoAmI")).toBe(`https://org.crm.dynamics.com/api/data/${DATAVERSE_API_VERSION}/WhoAmI`);
  });

  it("tolerates trailing/leading slashes on either part", () => {
    expect(dataverseApiUrl("https://org.crm.dynamics.com/", "/webresourceset")).toBe(`https://org.crm.dynamics.com/api/data/${DATAVERSE_API_VERSION}/webresourceset`);
  });

  it("keeps query strings intact", () => {
    expect(dataverseApiUrl("https://org.crm.dynamics.com", "solutions?$select=solutionid")).toBe(`https://org.crm.dynamics.com/api/data/${DATAVERSE_API_VERSION}/solutions?$select=solutionid`);
  });

  it("handles a missing org url", () => {
    expect(dataverseApiUrl(undefined, "WhoAmI")).toBe(`/api/data/${DATAVERSE_API_VERSION}/WhoAmI`);
  });
});
