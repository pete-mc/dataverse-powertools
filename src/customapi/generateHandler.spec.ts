import { describe, it, expect } from "vitest";
import { generateCustomApiHandler, customApiParameterCSharpType, splitPluginTypeName, customApiHandlerFileName } from "./generateHandler";
import { newCustomApiDefinition, CustomApiDefinition } from "./definition";

describe("customApiParameterCSharpType", () => {
  it.each([
    ["String", "string"],
    ["Integer", "int"],
    ["Boolean", "bool"],
    ["EntityReference", "EntityReference"],
    ["Money", "Money"],
    ["Picklist", "OptionSetValue"],
    ["StringArray", "string[]"],
    ["Guid", "System.Guid"],
    ["DateTime", "System.DateTime"],
  ] as const)("maps %s → %s", (type, csharp) => {
    expect(customApiParameterCSharpType(type)).toBe(csharp);
  });
});

describe("splitPluginTypeName", () => {
  it("splits a qualified type name", () => {
    expect(splitPluginTypeName("Sample.Plugins.DoTheThing")).toEqual({ namespaceName: "Sample.Plugins", className: "DoTheThing" });
  });

  it("defaults the namespace for an unqualified name", () => {
    expect(splitPluginTypeName("DoTheThing")).toEqual({ namespaceName: "Dataverse.Plugins", className: "DoTheThing" });
  });
});

describe("customApiHandlerFileName", () => {
  it("derives the file name from the class", () => {
    expect(customApiHandlerFileName(newCustomApiDefinition("x", "A.B.MyHandler"))).toBe("MyHandler.generated.cs");
  });
});

describe("generateCustomApiHandler", () => {
  const def = newCustomApiDefinition("sample_DoTheThing", "Sample.Plugins.DoTheThing");
  const code = generateCustomApiHandler(def);

  it("emits the namespace, request/response wrappers, and IPlugin class", () => {
    expect(code).toContain("namespace Sample.Plugins");
    expect(code).toContain("public sealed class DoTheThingRequest");
    expect(code).toContain("public sealed class DoTheThingResponse");
    expect(code).toContain("public sealed class DoTheThing : IPlugin");
    expect(code).toContain("public void Execute(IServiceProvider serviceProvider)");
  });

  it("generates a typed, guarded getter for a request parameter", () => {
    // sample has a String request param "InputValue"
    expect(code).toContain("public string InputValue =>");
    expect(code).toContain('_context.InputParameters.Contains("InputValue")');
    expect(code).toContain('(string)_context.InputParameters["InputValue"]');
  });

  it("generates a typed setter for a response property", () => {
    // sample has a String response prop "OutputValue"
    expect(code).toContain("public string OutputValue");
    expect(code).toContain('_context.OutputParameters["OutputValue"] = value;');
  });

  it("maps parameter types to their C# types in the generated code", () => {
    const typed: CustomApiDefinition = {
      ...def,
      requestParameters: [
        { uniqueName: "AccountId", name: "x.AccountId", type: "EntityReference" },
        { uniqueName: "Count", name: "x.Count", type: "Integer" },
      ],
    };
    const out = generateCustomApiHandler(typed);
    expect(out).toContain("public EntityReference AccountId =>");
    expect(out).toContain("public int Count =>");
  });

  it("handles a definition with no parameters gracefully", () => {
    const empty: CustomApiDefinition = { ...def, requestParameters: [], responseProperties: [] };
    const out = generateCustomApiHandler(empty);
    expect(out).toContain("// (no request parameters defined)");
    expect(out).toContain("// (no response properties defined)");
  });
});
