import { describe, it, expect } from "vitest";
import { DataverseAuthType, parseAuthType, buildAuthority, buildDataverseScopes, isConfidentialClient } from "./authTypes";

describe("parseAuthType", () => {
  it("recognises each auth type case-insensitively", () => {
    expect(parseAuthType("ClientSecret")).toBe(DataverseAuthType.ClientSecret);
    expect(parseAuthType("oauth")).toBe(DataverseAuthType.OAuth);
    expect(parseAuthType("Interactive")).toBe(DataverseAuthType.OAuth);
    expect(parseAuthType("CERTIFICATE")).toBe(DataverseAuthType.Certificate);
    expect(parseAuthType("cert")).toBe(DataverseAuthType.Certificate);
  });

  it("falls back to ClientSecret for unknown or missing values", () => {
    expect(parseAuthType(undefined)).toBe(DataverseAuthType.ClientSecret);
    expect(parseAuthType("")).toBe(DataverseAuthType.ClientSecret);
    expect(parseAuthType("something-else")).toBe(DataverseAuthType.ClientSecret);
  });
});

describe("buildAuthority", () => {
  it("builds a tenant authority", () => {
    expect(buildAuthority("11111111-1111-1111-1111-111111111111")).toBe("https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111");
  });

  it("uses the common authority when no tenant is supplied", () => {
    expect(buildAuthority(undefined)).toBe("https://login.microsoftonline.com/common");
    expect(buildAuthority("  ")).toBe("https://login.microsoftonline.com/common");
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

describe("isConfidentialClient", () => {
  it("is true for secret and certificate, false for interactive", () => {
    expect(isConfidentialClient(DataverseAuthType.ClientSecret)).toBe(true);
    expect(isConfidentialClient(DataverseAuthType.Certificate)).toBe(true);
    expect(isConfidentialClient(DataverseAuthType.OAuth)).toBe(false);
  });
});
