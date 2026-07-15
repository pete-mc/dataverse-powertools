// Parameter unique names are PascalCase by Dataverse convention, not identifiers.
/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from "vitest";
import { coerceParameterValue, buildActionInvokeBody, buildFunctionInvokeUrl } from "./invokePayloads";
import { newCustomApiDefinition, CustomApiDefinition } from "./definition";

describe("coerceParameterValue", () => {
  it("parses booleans", () => {
    expect(coerceParameterValue("Boolean", "true")).toBe(true);
    expect(coerceParameterValue("Boolean", "no")).toBe(false);
  });
  it("parses integers and decimals", () => {
    expect(coerceParameterValue("Integer", "42")).toBe(42);
    expect(coerceParameterValue("Decimal", "3.5")).toBe(3.5);
    expect(coerceParameterValue("Money", "9.99")).toBe(9.99);
  });
  it("splits string arrays", () => {
    expect(coerceParameterValue("StringArray", "a, b ,c")).toEqual(["a", "b", "c"]);
    expect(coerceParameterValue("StringArray", "")).toEqual([]);
  });
  it("keeps strings/guids/datetimes as strings", () => {
    expect(coerceParameterValue("String", " hi ")).toBe("hi");
    expect(coerceParameterValue("Guid", "00000000-0000-0000-0000-000000000000")).toBe("00000000-0000-0000-0000-000000000000");
  });
  it("parses JSON for complex types", () => {
    expect(coerceParameterValue("EntityReference", '{"id":"1","entityType":"account"}')).toEqual({ id: "1", entityType: "account" });
  });
});

describe("buildActionInvokeBody", () => {
  it("includes only provided params, typed", () => {
    const def: CustomApiDefinition = {
      ...newCustomApiDefinition("x", "A.B"),
      requestParameters: [
        { uniqueName: "Name", name: "x.Name", type: "String" },
        { uniqueName: "Count", name: "x.Count", type: "Integer" },
        { uniqueName: "Skip", name: "x.Skip", type: "String", isOptional: true },
      ],
    };
    expect(buildActionInvokeBody(def, { Name: "hi", Count: "3", Skip: "" })).toEqual({ Name: "hi", Count: 3 });
  });
});

describe("buildFunctionInvokeUrl", () => {
  const def = (params: CustomApiDefinition["requestParameters"]): CustomApiDefinition => ({
    ...newCustomApiDefinition("sample_Do", "A.B"),
    isFunction: true,
    requestParameters: params,
  });

  it("builds an empty-parenthesis url when no params", () => {
    expect(buildFunctionInvokeUrl(def([]), {})).toBe("sample_Do()");
  });

  it("builds parameter-aliased url with quoted string literals", () => {
    const url = buildFunctionInvokeUrl(def([{ uniqueName: "Name", name: "x.Name", type: "String" }]), { Name: "abc" });
    expect(url).toContain("sample_Do(Name=@p1)?");
    expect(url).toContain("@p1="); // alias @ stays literal (valid in the query)
    expect(decodeURIComponent(url)).toContain("@p1='abc'"); // value is percent-encoded, decodes back to quoted literal
  });

  it("does not quote numeric literals", () => {
    const url = buildFunctionInvokeUrl(def([{ uniqueName: "Count", name: "x.Count", type: "Integer" }]), { Count: "5" });
    expect(decodeURIComponent(url)).toContain("@p1=5");
  });
});
