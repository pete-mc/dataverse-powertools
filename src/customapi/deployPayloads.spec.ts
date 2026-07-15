import { describe, it, expect } from "vitest";
import {
  BINDING_TYPE,
  PROCESSING_STEP_TYPE,
  FIELD_TYPE,
  buildCustomApiCreatePayload,
  buildCustomApiUpdatePayload,
  buildRequestParameterCreatePayload,
  buildResponsePropertyCreatePayload,
  buildMemberUpdatePayload,
  reconcileByUniqueName,
} from "./deployPayloads";
import { newCustomApiDefinition, CustomApiDefinition } from "./definition";

describe("option-set maps (per customapi-tables docs)", () => {
  it("binding type", () => {
    expect(BINDING_TYPE.Global).toBe(0);
    expect(BINDING_TYPE.Entity).toBe(1);
    expect(BINDING_TYPE.EntityCollection).toBe(2);
  });
  it("processing step type", () => {
    expect(PROCESSING_STEP_TYPE.None).toBe(0);
    expect(PROCESSING_STEP_TYPE.AsyncOnly).toBe(1);
    expect(PROCESSING_STEP_TYPE.SyncAndAsync).toBe(2);
  });
  it("field type (customapifieldtype 0..12)", () => {
    expect(FIELD_TYPE.Boolean).toBe(0);
    expect(FIELD_TYPE.EntityReference).toBe(5);
    expect(FIELD_TYPE.String).toBe(10);
    expect(FIELD_TYPE.Guid).toBe(12);
  });
});

describe("buildCustomApiCreatePayload", () => {
  it("includes immutable columns + the plugin bind, with description falling back to displayName", () => {
    const def = newCustomApiDefinition("sample_Do", "Sample.Plugins.Do");
    const payload = buildCustomApiCreatePayload(def, "pt-1");
    expect(payload).toMatchObject({
      uniquename: "sample_Do",
      bindingtype: 0,
      isfunction: false,
      isprivate: false,
      allowedcustomprocessingsteptype: 0,
      description: "sample_Do", // empty description → displayName
    });
    expect(payload["PluginTypeId@odata.bind"]).toBe("/plugintypes(pt-1)");
    expect(payload).not.toHaveProperty("boundentitylogicalname"); // Global
  });

  it("adds boundentitylogicalname for a non-global binding", () => {
    const def: CustomApiDefinition = { ...newCustomApiDefinition("x", "A.B"), binding: "Entity", boundEntityLogicalName: "account" };
    expect(buildCustomApiCreatePayload(def, "pt").boundentitylogicalname).toBe("account");
  });
});

describe("buildCustomApiUpdatePayload", () => {
  it("omits immutable columns (bindingtype/isfunction/uniquename) and keeps mutable ones", () => {
    const def = newCustomApiDefinition("sample_Do", "Sample.Plugins.Do");
    const payload = buildCustomApiUpdatePayload(def, "pt-1");
    expect(payload).toMatchObject({ name: "sample_Do", displayname: "sample_Do", isprivate: false });
    expect(payload).not.toHaveProperty("bindingtype");
    expect(payload).not.toHaveProperty("isfunction");
    expect(payload).not.toHaveProperty("uniquename");
    expect(payload["PluginTypeId@odata.bind"]).toBe("/plugintypes(pt-1)");
  });
});

describe("member payloads", () => {
  it("request parameter create carries type int, isoptional, and the CustomAPI bind", () => {
    const payload = buildRequestParameterCreatePayload({ uniqueName: "AccountId", name: "x.AccountId", type: "EntityReference", isOptional: true }, "api-1");
    expect(payload).toMatchObject({ uniquename: "AccountId", type: 5, isoptional: true });
    expect(payload["CustomAPIId@odata.bind"]).toBe("/customapis(api-1)");
  });

  it("response property create has no isoptional", () => {
    const payload = buildResponsePropertyCreatePayload({ uniqueName: "Out", name: "x.Out", type: "String" }, "api-1");
    expect(payload).toMatchObject({ uniquename: "Out", type: 10 });
    expect(payload).not.toHaveProperty("isoptional");
  });

  it("member update carries only mutable fields", () => {
    expect(buildMemberUpdatePayload({ uniqueName: "AccountId", name: "x", type: "EntityReference", displayName: "Account" })).toEqual({
      displayname: "Account",
      description: "AccountId",
    });
  });
});

describe("reconcileByUniqueName", () => {
  const desired = [
    { uniqueName: "Keep", name: "x.Keep", type: "String" as const },
    { uniqueName: "Add", name: "x.Add", type: "String" as const },
  ];
  const existing = [
    { id: "id-keep", uniquename: "keep" }, // case-insensitive match
    { id: "id-drop", uniquename: "Drop" },
  ];

  it("splits desired vs existing into create / update / delete", () => {
    const plan = reconcileByUniqueName(desired, existing);
    expect(plan.toCreate.map((c) => c.uniqueName)).toEqual(["Add"]);
    expect(plan.toUpdate.map((u) => ({ name: u.desired.uniqueName, id: u.id }))).toEqual([{ name: "Keep", id: "id-keep" }]);
    expect(plan.toDelete).toEqual(["id-drop"]);
  });

  it("all-new when nothing exists", () => {
    const plan = reconcileByUniqueName(desired, []);
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toDelete).toHaveLength(0);
  });

  it("deletes everything when the definition has no members", () => {
    const plan = reconcileByUniqueName([], existing);
    expect(plan.toDelete).toEqual(["id-keep", "id-drop"]);
  });
});
