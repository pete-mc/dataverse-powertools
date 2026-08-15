import { describe, it, expect } from "vitest";
import { addIntersect, removeIntersect, addFormToIntersect, removeFormFromIntersect, MINIMUM_FORMS_PER_INTERSECT } from "./intersectOperations";
import { FormIntersect } from "../../context";
import { DataverseFormRecord } from "../../general/dataverse/getDataverseForms";

// #80's "tree-view CRUD tests (Earlybound Options, Form Intersects)", absorbed by #143. These rules
// used to live inside the tree provider's registerCommand closures, where nothing could reach them.

const form = (formId: string, displayName = formId): DataverseFormRecord => ({ formId, displayName, formType: "Main" }) as DataverseFormRecord;

const intersect = (overrides: Partial<FormIntersect> = {}): FormIntersect =>
  ({ id: "i1", name: "Account forms", entity: "account", forms: [form("f1"), form("f2")], ...overrides }) as FormIntersect;

describe("addIntersect", () => {
  it("adds to an empty list — a project with no intersects yet", () => {
    const result = addIntersect(undefined, intersect());
    expect(result.ok && result.intersects).toHaveLength(1);
  });

  it("appends without disturbing the existing entries", () => {
    const existing = intersect();
    const result = addIntersect([existing], intersect({ id: "i2", name: "Contact forms" }));
    expect(result.ok && result.intersects.map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  it("refuses a duplicate id", () => {
    const result = addIntersect([intersect()], intersect());
    expect(result.ok).toBe(false);
  });

  it("does not mutate the list it was given", () => {
    const list = [intersect()];
    addIntersect(list, intersect({ id: "i2" }));
    expect(list).toHaveLength(1);
  });
});

describe("removeIntersect", () => {
  it("removes by id", () => {
    const result = removeIntersect([intersect(), intersect({ id: "i2" })], "i1");
    expect(result.ok && result.intersects.map((i) => i.id)).toEqual(["i2"]);
  });

  it("reports not-found rather than silently doing nothing", () => {
    const result = removeIntersect([intersect()], "nope");
    expect(result).toEqual({ ok: false, reason: "Unable to remove form intersect, form intersect not found." });
  });

  it("reports not-found for a missing id and an empty list", () => {
    expect(removeIntersect([intersect()], undefined).ok).toBe(false);
    expect(removeIntersect(undefined, "i1").ok).toBe(false);
  });
});

describe("addFormToIntersect", () => {
  it("adds the chosen form", () => {
    const result = addFormToIntersect([intersect()], "i1", form("f3"));
    expect(result.ok && result.intersects[0].forms.map((f) => f.formId)).toEqual(["f1", "f2", "f3"]);
  });

  // The quick pick returns undefined when dismissed; that must not be treated as a form.
  it("refuses when the form pick was dismissed", () => {
    expect(addFormToIntersect([intersect()], "i1", undefined).ok).toBe(false);
  });

  it("refuses when the intersect no longer exists", () => {
    expect(addFormToIntersect([intersect()], "gone", form("f3")).ok).toBe(false);
  });

  it("refuses a form already in the intersect rather than listing it twice", () => {
    expect(addFormToIntersect([intersect()], "i1", form("f2")).ok).toBe(false);
  });

  it("leaves the other intersects alone", () => {
    const result = addFormToIntersect([intersect(), intersect({ id: "i2", name: "Other", forms: [form("x1"), form("x2")] })], "i1", form("f3"));
    expect(result.ok && result.intersects[1].forms.map((f) => f.formId)).toEqual(["x1", "x2"]);
  });
});

describe("removeFormFromIntersect", () => {
  // The rule that motivated extracting all of this: an intersect describes what two or more forms
  // have in common, so dropping to one produces a meaningless intersect — and it does so silently,
  // because the settings file happily stores it and the failure only shows up in built form XML.
  it("refuses to take an intersect below the minimum of two forms", () => {
    const result = removeFormFromIntersect([intersect()], "Account forms", "f1");
    expect(result).toEqual({ ok: false, reason: `Unable to remove form, form intersect must have at least ${MINIMUM_FORMS_PER_INTERSECT} forms.` });
  });

  it("removes a form when enough remain", () => {
    const result = removeFormFromIntersect([intersect({ forms: [form("f1"), form("f2"), form("f3")] })], "Account forms", "f2");
    expect(result.ok && result.intersects[0].forms.map((f) => f.formId)).toEqual(["f1", "f3"]);
  });

  it("still refuses at exactly the minimum, not just below it", () => {
    expect(removeFormFromIntersect([intersect({ forms: [form("f1"), form("f2")] })], "Account forms", "f1").ok).toBe(false);
    expect(removeFormFromIntersect([intersect({ forms: [form("f1"), form("f2"), form("f3")] })], "Account forms", "f1").ok).toBe(true);
  });

  // The tree item carries the PARENT NAME rather than an id for this one, which is why a rename
  // has to keep matching — a stale parent name reads as "intersect not found".
  it("reports not-found when the parent name doesn't match", () => {
    const result = removeFormFromIntersect([intersect({ forms: [form("f1"), form("f2"), form("f3")] })], "Renamed", "f1");
    expect(result).toEqual({ ok: false, reason: "Unable to remove form, form intersect not found." });
  });

  it("reports not-found when the form isn't in that intersect", () => {
    const result = removeFormFromIntersect([intersect({ forms: [form("f1"), form("f2"), form("f3")] })], "Account forms", "f9");
    expect(result.ok).toBe(false);
  });

  it("does not mutate the intersect it was given", () => {
    const list = [intersect({ forms: [form("f1"), form("f2"), form("f3")] })];
    removeFormFromIntersect(list, "Account forms", "f2");
    expect(list[0].forms).toHaveLength(3);
  });
});
