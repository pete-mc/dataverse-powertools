import { describe, it, expect } from "vitest";
import {
  generateCustomApiWrappers,
  generateCustomApiUserHandler,
  looksLikeLegacyHandler,
  customApiParameterCSharpType,
  splitPluginTypeName,
  customApiHandlerFileName,
  customApiUserHandlerFileName,
} from "./generateHandler";
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

describe("generateCustomApiWrappers", () => {
  const def = newCustomApiDefinition("sample_DoTheThing", "Sample.Plugins.DoTheThing");
  const code = generateCustomApiWrappers(def);

  it("emits the namespace and the request/response wrappers", () => {
    expect(code).toContain("namespace Sample.Plugins");
    expect(code).toContain("public sealed class DoTheThingRequest");
    expect(code).toContain("public sealed class DoTheThingResponse");
  });

  // #254: the implementation lives in its own file now, so regenerating cannot take the user's Execute
  // body with it. If it ever comes back into the generated file, this fails.
  it("does NOT contain the IPlugin implementation", () => {
    expect(code).not.toContain(": IPlugin");
    expect(code).not.toContain("void Execute(IServiceProvider");
  });

  it("warns in the file itself that edits will be lost, and points at the user file", () => {
    expect(code).toContain("GENERATED FILE");
    expect(code).toContain("DoTheThing.cs");
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
    const out = generateCustomApiWrappers(typed);
    expect(out).toContain("public EntityReference AccountId =>");
    expect(out).toContain("public int Count =>");
  });

  it("handles a definition with no parameters gracefully", () => {
    const empty: CustomApiDefinition = { ...def, requestParameters: [], responseProperties: [] };
    const out = generateCustomApiWrappers(empty);
    expect(out).toContain("// (no request parameters defined)");
    expect(out).toContain("// (no response properties defined)");
  });
});

// The other half of the #254 split: the file the user owns.
describe("generateCustomApiUserHandler", () => {
  const def = newCustomApiDefinition("sample_DoTheThing", "Sample.Plugins.DoTheThing");
  const code = generateCustomApiUserHandler(def);

  it("is the IPlugin implementation, wired to the generated wrappers", () => {
    expect(code).toContain("public sealed class DoTheThing : IPlugin");
    expect(code).toContain("public void Execute(IServiceProvider serviceProvider)");
    expect(code).toContain("new DoTheThingRequest(context)");
    expect(code).toContain("new DoTheThingResponse(context)");
  });

  it("says it will not be overwritten, so the reader knows where their code is safe", () => {
    expect(code).toContain("YOUR FILE");
    expect(code).toContain("never overwritten");
  });

  it("leaves a TODO naming the operation", () => {
    expect(code).toContain('// TODO: implement the "sample_DoTheThing" operation.');
  });

  it("does not duplicate the wrapper classes", () => {
    expect(code).not.toContain("public sealed class DoTheThingRequest");
    expect(code).not.toContain("public sealed class DoTheThingResponse");
  });
});

describe("customApiUserHandlerFileName", () => {
  it("is the class name, with no .generated marker", () => {
    expect(customApiUserHandlerFileName(newCustomApiDefinition("x", "A.B.MyHandler"))).toBe("MyHandler.cs");
  });
});

describe("looksLikeLegacyHandler", () => {
  // Refusing to overwrite a pre-split file is what stops #254 from biting the people it already bit.
  it("recognises a pre-split generated file by its IPlugin implementation", () => {
    const legacy = generateCustomApiUserHandler(newCustomApiDefinition("x", "A.B.C"));
    expect(looksLikeLegacyHandler(legacy)).toBe(true);
    expect(looksLikeLegacyHandler("public sealed class C : IPlugin { }")).toBe(true);
    expect(looksLikeLegacyHandler("public void Execute(IServiceProvider serviceProvider)")).toBe(true);
  });

  it("does not flag a wrappers-only file", () => {
    expect(looksLikeLegacyHandler(generateCustomApiWrappers(newCustomApiDefinition("x", "A.B.C")))).toBe(false);
    expect(looksLikeLegacyHandler("")).toBe(false);
  });
});
