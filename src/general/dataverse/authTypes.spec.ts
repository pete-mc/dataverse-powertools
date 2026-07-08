import { describe, it, expect } from "vitest";
import { DataverseAuthType, parseAuthType, buildDataverseScopes } from "./authTypes";

describe("parseAuthType", () => {
  it("recognises each auth type case-insensitively", () => {
    expect(parseAuthType("ClientSecret")).toBe(DataverseAuthType.clientSecret);
    expect(parseAuthType("oauth")).toBe(DataverseAuthType.oauth);
    expect(parseAuthType("Interactive")).toBe(DataverseAuthType.oauth);
  });

  it("falls back to ClientSecret for unknown or missing values", () => {
    expect(parseAuthType(undefined)).toBe(DataverseAuthType.clientSecret);
    expect(parseAuthType("")).toBe(DataverseAuthType.clientSecret);
    expect(parseAuthType("something-else")).toBe(DataverseAuthType.clientSecret);
  });
});

describe("buildDataverseScopes", () => {
  it("builds the .default scope from the org url and strips trailing slashes", () => {
    expect(buildDataverseScopes("https://org.crm.dynamics.com")).toEqual(["https://org.crm.dynamics.com/.default"]);
    expect(buildDataverseScopes("https://org.crm.dynamics.com/")).toEqual(["https://org.crm.dynamics.com/.default"]);
  });

  it("returns no scopes when there is no url", () => {
    expect(buildDataverseScopes("")).toEqual([]);
    expect(buildDataverseScopes(undefined)).toEqual([]);
  });
});
