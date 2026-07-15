import { describe, it, expect } from "vitest";
import { generatePortalWebApiClient, newPortalWebApiDefinition, defaultTypeName, portalWebApiClientFileName, PortalWebApiDefinition } from "./portalWebApiClient";

describe("defaultTypeName", () => {
  it("singularises the entity set", () => {
    expect(defaultTypeName("accounts")).toBe("Account");
    expect(defaultTypeName("opportunities")).toBe("Opportunity");
    expect(defaultTypeName("contacts")).toBe("Contact");
  });
});

describe("newPortalWebApiDefinition / file name", () => {
  it("seeds a definition and derives the file name", () => {
    const def = newPortalWebApiDefinition("accounts");
    expect(def).toMatchObject({ entitySet: "accounts", typeName: "Account" });
    expect(portalWebApiClientFileName(def)).toBe("accounts.webapi.ts");
  });
});

describe("generatePortalWebApiClient", () => {
  const def: PortalWebApiDefinition = { entitySet: "accounts", typeName: "Account", fields: { name: "string", revenue: "number" } };
  const code = generatePortalWebApiClient(def);

  it("emits a typed record interface", () => {
    expect(code).toContain("export interface Account");
    expect(code).toContain("name?: string;");
    expect(code).toContain("revenue?: number;");
  });

  it("emits CRUD helpers using webapi.safeAjax against /_api/<entityset>", () => {
    expect(code).toContain('url: "/_api/accounts"');
    expect(code).toContain("export function createAccount(record: Account): Promise<string>");
    expect(code).toContain("export function retrieveAccount(id: string, select?: string): Promise<Account>");
    expect(code).toContain("export function updateAccount(id: string, record: Account): Promise<void>");
    expect(code).toContain("export function deleteAccount(id: string): Promise<void>");
    expect(code).toContain("webapi.safeAjax");
  });

  it("uses the documented verbs for each operation", () => {
    expect(code).toContain('type: "POST"');
    expect(code).toContain('type: "PATCH"');
    expect(code).toContain('type: "DELETE"');
    expect(code).toContain('xhr.getResponseHeader("entityid")'); // create returns the new id
  });

  it("falls back to an index signature when no fields are given", () => {
    const bare = generatePortalWebApiClient({ entitySet: "widgets" });
    expect(bare).toContain("[field: string]: unknown;");
    expect(bare).toContain("export interface Widget");
  });
});
