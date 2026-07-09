import { describe, it, expect } from "vitest";
import {
  parseConnectionString,
  normalizeOrganizationUrl,
  getOrganizationUrl,
  buildConnectionString,
  buildAuthConnectionString,
  mergeCredentialConnectionString,
} from "./connectionString";

describe("mergeCredentialConnectionString", () => {
  it("inserts the separator when the persisted base has no trailing ';' (the reload auth bug)", () => {
    // The stored dataverse-powertools.json keeps secrets out and ends at Url with no ';'.
    const base = "AuthType=ClientSecret;LoginPrompt=Never;Url=https://org32218dcd.crm11.dynamics.com";
    // Secret storage returns ClientId/ClientSecret (TenantID already stripped).
    const credentials = "ClientId=f906614e-e545-4be0-a5e6-e802941fb305;ClientSecret=sh-secret;";
    expect(mergeCredentialConnectionString(base, credentials)).toBe(
      "AuthType=ClientSecret;LoginPrompt=Never;Url=https://org32218dcd.crm11.dynamics.com;ClientId=f906614e-e545-4be0-a5e6-e802941fb305;ClientSecret=sh-secret",
    );
  });

  it("produces a string whose parsed url and clientId are clean (not glued together)", () => {
    const merged = mergeCredentialConnectionString("AuthType=ClientSecret;LoginPrompt=Never;Url=https://org.crm.dynamics.com", "ClientId=abc;ClientSecret=xyz;");
    const parts = parseConnectionString(merged);
    expect(parts.url).toBe("https://org.crm.dynamics.com");
    expect(parts.clientId).toBe("abc");
    expect(parts.clientSecret).toBe("xyz");
  });

  it("tolerates a base that already ends with ';'", () => {
    expect(mergeCredentialConnectionString("AuthType=ClientSecret;Url=https://org.crm.dynamics.com;", "ClientId=abc;ClientSecret=xyz;")).toBe(
      "AuthType=ClientSecret;Url=https://org.crm.dynamics.com;ClientId=abc;ClientSecret=xyz",
    );
  });
});

describe("buildAuthConnectionString", () => {
  it("keeps the secret and LoginPrompt for client-secret auth", () => {
    expect(buildAuthConnectionString({ authType: "ClientSecret", url: "https://org.crm.dynamics.com", clientId: "abc", clientSecret: "s3cr3t" })).toBe(
      "AuthType=ClientSecret;LoginPrompt=Never;Url=https://org.crm.dynamics.com;ClientId=abc;ClientSecret=s3cr3t",
    );
  });

  it("carries nothing sensitive for interactive auth", () => {
    const result = buildAuthConnectionString({ authType: "OAuth", url: "https://org.crm.dynamics.com", clientId: "abc" });
    expect(result).toBe("AuthType=OAuth;Url=https://org.crm.dynamics.com;ClientId=abc");
    expect(result).not.toContain("ClientSecret");
  });

  it("omits an empty client id for interactive auth", () => {
    expect(buildAuthConnectionString({ authType: "OAuth", url: "https://org.crm.dynamics.com" })).toBe("AuthType=OAuth;Url=https://org.crm.dynamics.com");
  });
});

describe("parseConnectionString", () => {
  it("parses a full service-principal connection string", () => {
    const parsed = parseConnectionString("AuthType=ClientSecret;LoginPrompt=Never;Url=https://org.crm.dynamics.com;ClientId=abc-123;ClientSecret=s3cr3t");
    expect(parsed.authType).toBe("ClientSecret");
    expect(parsed.loginPrompt).toBe("Never");
    expect(parsed.url).toBe("https://org.crm.dynamics.com");
    expect(parsed.clientId).toBe("abc-123");
    expect(parsed.clientSecret).toBe("s3cr3t");
  });

  it("is order-independent (the old fixed-index parser was not)", () => {
    const parsed = parseConnectionString("ClientSecret=s3cr3t;Url=https://org.crm.dynamics.com;ClientId=abc-123");
    expect(parsed.url).toBe("https://org.crm.dynamics.com");
    expect(parsed.clientId).toBe("abc-123");
    expect(parsed.clientSecret).toBe("s3cr3t");
  });

  it("is case-insensitive on keys", () => {
    const parsed = parseConnectionString("url=https://org.crm.dynamics.com;CLIENTID=abc-123;clientsecret=s3cr3t");
    expect(parsed.url).toBe("https://org.crm.dynamics.com");
    expect(parsed.clientId).toBe("abc-123");
    expect(parsed.clientSecret).toBe("s3cr3t");
  });

  it("parses TenantID", () => {
    expect(parseConnectionString("ClientId=a;ClientSecret=b;TenantID=tenant-9").tenantId).toBe("tenant-9");
  });

  it("tolerates trailing semicolons and whitespace", () => {
    const parsed = parseConnectionString("  Url=https://org.crm.dynamics.com ; ClientId=abc-123 ; ");
    expect(parsed.url).toBe("https://org.crm.dynamics.com");
    expect(parsed.clientId).toBe("abc-123");
  });

  it("returns an empty object for empty/undefined input", () => {
    expect(parseConnectionString("")).toEqual({});
    expect(parseConnectionString(undefined)).toEqual({});
    expect(parseConnectionString(null)).toEqual({});
  });

  it("ignores segments without '='", () => {
    const parsed = parseConnectionString("garbage;Url=https://org.crm.dynamics.com");
    expect(parsed.url).toBe("https://org.crm.dynamics.com");
  });

  it("preserves unknown keys under their lower-cased name", () => {
    expect(parseConnectionString("RequireNewInstance=True").requirenewinstance).toBe("True");
  });
});

describe("normalizeOrganizationUrl / getOrganizationUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeOrganizationUrl("https://org.crm.dynamics.com///")).toBe("https://org.crm.dynamics.com");
  });

  it("coerces http and scheme-less urls to https (Dataverse is https-only)", () => {
    expect(normalizeOrganizationUrl("http://org.crm.dynamics.com")).toBe("https://org.crm.dynamics.com");
    expect(normalizeOrganizationUrl("org.crm.dynamics.com")).toBe("https://org.crm.dynamics.com");
    expect(normalizeOrganizationUrl("HTTP://org.crm.dynamics.com/")).toBe("https://org.crm.dynamics.com");
    expect(normalizeOrganizationUrl("https://org.crm.dynamics.com")).toBe("https://org.crm.dynamics.com");
  });

  it("returns empty string for missing url", () => {
    expect(normalizeOrganizationUrl(undefined)).toBe("");
    expect(getOrganizationUrl("ClientId=a")).toBe("");
  });

  it("extracts and normalizes the url from a connection string", () => {
    expect(getOrganizationUrl("Url=https://org.crm.dynamics.com/;ClientId=a")).toBe("https://org.crm.dynamics.com");
  });
});

describe("buildConnectionString", () => {
  it("emits present parts in a stable order", () => {
    const s = buildConnectionString({ url: "https://org.crm.dynamics.com", clientId: "abc-123", clientSecret: "s3cr3t", authType: "ClientSecret", loginPrompt: "Never" });
    expect(s).toBe("AuthType=ClientSecret;LoginPrompt=Never;Url=https://org.crm.dynamics.com;ClientId=abc-123;ClientSecret=s3cr3t");
  });

  it("omits empty/undefined parts", () => {
    expect(buildConnectionString({ url: "https://org.crm.dynamics.com", clientId: "" })).toBe("Url=https://org.crm.dynamics.com");
  });

  it("round-trips through parse", () => {
    const original = "AuthType=ClientSecret;LoginPrompt=Never;Url=https://org.crm.dynamics.com;ClientId=abc-123;ClientSecret=s3cr3t";
    expect(buildConnectionString(parseConnectionString(original))).toBe(original);
  });
});
