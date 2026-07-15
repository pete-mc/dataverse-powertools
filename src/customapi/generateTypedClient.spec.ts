import { describe, it, expect } from "vitest";
import { generateTypedClient, customApiParameterTsType, customApiParameterEdmType, structuralProperty, customApiClientFileName } from "./generateTypedClient";
import { newCustomApiDefinition, CustomApiDefinition } from "./definition";

describe("type maps", () => {
  it("maps parameter types to TS types", () => {
    expect(customApiParameterTsType("String")).toBe("string");
    expect(customApiParameterTsType("Integer")).toBe("number");
    expect(customApiParameterTsType("Boolean")).toBe("boolean");
    expect(customApiParameterTsType("StringArray")).toBe("string[]");
    expect(customApiParameterTsType("DateTime")).toBe("Date");
  });

  it("maps parameter types to Edm type names", () => {
    expect(customApiParameterEdmType("String")).toBe("Edm.String");
    expect(customApiParameterEdmType("Integer")).toBe("Edm.Int32");
    expect(customApiParameterEdmType("Guid")).toBe("Edm.Guid");
    expect(customApiParameterEdmType("StringArray")).toBe("Collection(Edm.String)");
  });

  it("maps structural property (1 primitive, 4 collection, 5 entity)", () => {
    expect(structuralProperty("String")).toBe(1);
    expect(structuralProperty("StringArray")).toBe(4);
    expect(structuralProperty("EntityCollection")).toBe(4);
    expect(structuralProperty("Entity")).toBe(5);
    expect(structuralProperty("EntityReference")).toBe(5);
  });
});

describe("customApiClientFileName", () => {
  it("derives from the class", () => {
    expect(customApiClientFileName(newCustomApiDefinition("x", "A.B.MyOp"))).toBe("MyOp.client.ts");
  });
});

describe("generateTypedClient", () => {
  const def = newCustomApiDefinition("sample_DoTheThing", "Sample.Plugins.DoTheThing");
  const code = generateTypedClient(def);

  it("emits typed request/response interfaces and a camelCased function", () => {
    expect(code).toContain("export interface DoTheThingRequest");
    expect(code).toContain("export interface DoTheThingResponse");
    expect(code).toContain("export async function sampleDoTheThing(request: DoTheThingRequest): Promise<DoTheThingResponse>");
    expect(code).toContain("InputValue: string;"); // sample String request param
    expect(code).toContain("OutputValue: string;"); // sample String response prop
  });

  it("emits the Xrm getMetadata shape with operationType 0 for an Action", () => {
    expect(code).toContain('operationName: "sample_DoTheThing"');
    expect(code).toContain("operationType: 0");
    expect(code).toContain('InputValue: { typeName: "Edm.String", structuralProperty: 1 }');
    expect(code).toContain("Xrm.WebApi.online.execute(payload)");
  });

  it("uses operationType 1 for a Function", () => {
    const fn: CustomApiDefinition = { ...def, isFunction: true };
    expect(generateTypedClient(fn)).toContain("operationType: 1");
  });

  it("marks optional request parameters with ?", () => {
    const withOptional: CustomApiDefinition = {
      ...def,
      requestParameters: [{ uniqueName: "Maybe", name: "x.Maybe", type: "String", isOptional: true }],
    };
    expect(generateTypedClient(withOptional)).toContain("Maybe?: string;");
  });
});
