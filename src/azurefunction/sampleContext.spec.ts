import { describe, it, expect } from "vitest";
import { buildSampleRemoteExecutionContext } from "./sampleContext";

describe("buildSampleRemoteExecutionContext", () => {
  const ctx = buildSampleRemoteExecutionContext({ messageName: "Create", primaryEntityName: "account", targetAttributes: { name: "Contoso" }, timestampMs: 1000 });

  it("sets the top-level context fields per the documented wire format", () => {
    expect(ctx.MessageName).toBe("Create");
    expect(ctx.PrimaryEntityName).toBe("account");
    expect(ctx.Stage).toBe(40);
    expect(ctx.Mode).toBe(1);
    expect(ctx.OperationCreatedOn).toBe("/Date(1000)/");
    expect(ctx.ParentContext).toBeNull();
  });

  it("shapes InputParameters as a KeyValuePair array with a typed Target entity", () => {
    const input = ctx.InputParameters as { key: string; value: Record<string, unknown> }[];
    expect(input).toHaveLength(1);
    expect(input[0].key).toBe("Target");
    const target = input[0].value;
    expect(target.__type).toBe("Entity:http://schemas.microsoft.com/xrm/2011/Contracts");
    expect(target.LogicalName).toBe("account");
    expect(target.Attributes).toEqual([{ key: "name", value: "Contoso" }]);
  });

  it("defaults stage/mode and empty images/params", () => {
    const c = buildSampleRemoteExecutionContext({ messageName: "Update", primaryEntityName: "contact" });
    expect(c.Stage).toBe(40);
    expect(c.Mode).toBe(1);
    expect(c.PreEntityImages).toEqual([]);
    expect(c.PostEntityImages).toEqual([]);
    expect(c.OutputParameters).toEqual([]);
    expect((c.InputParameters as { value: Record<string, unknown> }[])[0].value.Attributes).toEqual([]);
  });

  it("honours an overridden stage/mode (e.g. synchronous pre-op)", () => {
    const c = buildSampleRemoteExecutionContext({ messageName: "Create", primaryEntityName: "account", stage: 20, mode: 0 });
    expect(c.Stage).toBe(20);
    expect(c.Mode).toBe(0);
  });

  it("uses valid GUID placeholders", () => {
    const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(ctx.OrganizationId).toMatch(guid);
    expect(ctx.UserId).toMatch(guid);
    expect(ctx.PrimaryEntityId).toMatch(guid);
  });
});
