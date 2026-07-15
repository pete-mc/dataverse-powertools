import { describe, it, expect } from "vitest";
import { validateCustomApiDefinition } from "./validate";
import { newCustomApiDefinition, CustomApiDefinition } from "./definition";

function valid(): CustomApiDefinition {
  return newCustomApiDefinition("sample_DoTheThing", "Sample.Plugins.DoTheThing");
}

describe("validateCustomApiDefinition", () => {
  it("accepts the seeded sample definition", () => {
    expect(validateCustomApiDefinition(valid())).toEqual([]);
  });

  it("flags missing required fields", () => {
    const def = { ...valid(), uniqueName: "", name: "", displayName: "", pluginTypeName: "" };
    const errors = validateCustomApiDefinition(def);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining("uniqueName is required"), expect.stringContaining("pluginTypeName is required")]));
  });

  it("rejects an invalid uniqueName", () => {
    expect(validateCustomApiDefinition({ ...valid(), uniqueName: "9bad name" })).toEqual(expect.arrayContaining([expect.stringContaining("must start with a letter")]));
  });

  it("rejects an invalid binding value", () => {
    expect(validateCustomApiDefinition({ ...valid(), binding: "Nonsense" as CustomApiDefinition["binding"] })).toEqual(
      expect.arrayContaining([expect.stringContaining('binding "Nonsense" is invalid')]),
    );
  });

  it("requires boundEntityLogicalName for a non-global binding", () => {
    expect(validateCustomApiDefinition({ ...valid(), binding: "Entity" })).toEqual(expect.arrayContaining([expect.stringContaining("boundEntityLogicalName is required")]));
  });

  it("accepts a non-global binding with a bound entity", () => {
    expect(validateCustomApiDefinition({ ...valid(), binding: "Entity", boundEntityLogicalName: "account" })).toEqual([]);
  });

  it("forbids boundEntityLogicalName on a Global binding", () => {
    expect(validateCustomApiDefinition({ ...valid(), binding: "Global", boundEntityLogicalName: "account" })).toEqual(
      expect.arrayContaining([expect.stringContaining("must not be set for a Global binding")]),
    );
  });

  it("detects duplicate request-parameter unique names (case-insensitive)", () => {
    const def = valid();
    def.requestParameters = [
      { uniqueName: "Foo", name: "x.Foo", type: "String" },
      { uniqueName: "foo", name: "x.foo", type: "String" },
    ];
    expect(validateCustomApiDefinition(def)).toEqual(expect.arrayContaining([expect.stringContaining("duplicate uniqueName")]));
  });

  it("rejects an invalid parameter type", () => {
    const def = valid();
    def.responseProperties = [{ uniqueName: "Out", name: "x.Out", type: "Nope" as CustomApiDefinition["responseProperties"][number]["type"] }];
    expect(validateCustomApiDefinition(def)).toEqual(expect.arrayContaining([expect.stringContaining("is not a valid Custom API parameter type")]));
  });

  it("rejects an invalid parameter name", () => {
    const def = valid();
    def.requestParameters = [{ uniqueName: "bad-name", name: "x", type: "String" }];
    expect(validateCustomApiDefinition(def)).toEqual(expect.arrayContaining([expect.stringContaining('requestParameters "bad-name"')]));
  });
});
