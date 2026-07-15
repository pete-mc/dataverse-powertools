// Server Logic request/response field names are PascalCase by convention.
/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from "vitest";
import { generateServerLogicClient, newServerLogicDefinition, serverLogicClientFileName, ServerLogicDefinition } from "./serverLogicClient";

describe("newServerLogicDefinition", () => {
  it("seeds a POST logic with one request + response field", () => {
    const def = newServerLogicDefinition("getWidgets");
    expect(def).toMatchObject({ name: "getWidgets", method: "POST" });
    expect(def.request).toBeTruthy();
    expect(def.response).toBeTruthy();
  });
});

describe("serverLogicClientFileName", () => {
  it("appends .client.ts", () => {
    expect(serverLogicClientFileName(newServerLogicDefinition("getWidgets"))).toBe("getWidgets.client.ts");
  });
});

describe("generateServerLogicClient", () => {
  const def = newServerLogicDefinition("getWidgets");
  const code = generateServerLogicClient(def);

  it("emits typed request/response interfaces + a camelCased function", () => {
    expect(code).toContain("export interface GetWidgetsRequest");
    expect(code).toContain("export interface GetWidgetsResponse");
    expect(code).toContain("export function getWidgets(request: GetWidgetsRequest): Promise<GetWidgetsResponse>");
    expect(code).toContain("InputValue: string;");
    expect(code).toContain("OutputValue: string;");
  });

  it("calls shell.safeAjax against the serverlogics endpoint with the right verb", () => {
    expect(code).toContain('url: "/_api/serverlogics/getWidgets"');
    expect(code).toContain('type: "POST"');
    expect(code).toContain("data: JSON.stringify(request)"); // POST sends a body
    expect(code).toContain("shell.safeAjax");
  });

  it("omits the request body for a GET", () => {
    const get: ServerLogicDefinition = { ...def, method: "GET" };
    const code = generateServerLogicClient(get);
    expect(code).toContain('type: "GET"');
    expect(code).not.toContain("data: JSON.stringify(request)");
  });

  it("emits custom field types verbatim", () => {
    const typed: ServerLogicDefinition = { name: "search", method: "POST", request: { Term: "string", Take: "number" }, response: { Items: "string[]" } };
    const code = generateServerLogicClient(typed);
    expect(code).toContain("Term: string;");
    expect(code).toContain("Take: number;");
    expect(code).toContain("Items: string[];");
  });
});
