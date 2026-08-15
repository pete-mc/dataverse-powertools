import { FormIntersect } from "../../context";
import { DataverseFormRecord } from "../../general/dataverse/getDataverseForms";

// The Form Intersects tree's CRUD rules, without `vscode`.
//
// These lived inside the TreeDataProvider's registerCommand closures, so the one rule that
// genuinely matters — a form intersect needs at least two forms, because an intersect of one form
// is not an intersect — was unreachable from any test. Breaking it doesn't throw: it writes a
// one-form intersect into dataverse-powertools.json, and the form-XML that later gets built from
// it is silently wrong.
//
// Each operation returns either the new list or a reason, so the caller does the talking (showing
// the error message) and the rule itself stays testable.

export type IntersectResult = { ok: true; intersects: FormIntersect[] } | { ok: false; reason: string };

/** The minimum number of forms an intersect is meaningful with. */
export const MINIMUM_FORMS_PER_INTERSECT = 2;

export function addIntersect(intersects: FormIntersect[] | undefined, intersect: FormIntersect): IntersectResult {
  const list = intersects ?? [];
  if (list.some((existing) => existing.id === intersect.id)) {
    return { ok: false, reason: "That form intersect already exists." };
  }
  return { ok: true, intersects: [...list, intersect] };
}

export function removeIntersect(intersects: FormIntersect[] | undefined, id: string | undefined): IntersectResult {
  const list = intersects ?? [];
  if (!id || !list.some((intersect) => intersect.id === id)) {
    return { ok: false, reason: "Unable to remove form intersect, form intersect not found." };
  }
  return { ok: true, intersects: list.filter((intersect) => intersect.id !== id) };
}

export function addFormToIntersect(intersects: FormIntersect[] | undefined, id: string | undefined, form: DataverseFormRecord | undefined): IntersectResult {
  const list = intersects ?? [];
  const target = list.find((intersect) => intersect.id === id);
  if (!target || !form) {
    return { ok: false, reason: "Unable to add form, no form selected or form intersect not found." };
  }
  if (target.forms.some((existing) => existing.formId === form.formId)) {
    return { ok: false, reason: "That form is already part of this intersect." };
  }
  return { ok: true, intersects: list.map((intersect) => (intersect === target ? { ...intersect, forms: [...intersect.forms, form] } : intersect)) };
}

/**
 * Remove a form from the intersect named `intersectName`.
 *
 * Refuses below the minimum: an intersect exists to describe what two or more forms have in
 * common, so dropping to one silently produces a meaningless intersect rather than an error.
 */
export function removeFormFromIntersect(intersects: FormIntersect[] | undefined, intersectName: string | undefined, formId: string | undefined): IntersectResult {
  const list = intersects ?? [];
  const target = list.find((intersect) => intersect.name === intersectName);
  if (!target) {
    return { ok: false, reason: "Unable to remove form, form intersect not found." };
  }
  if (target.forms.length <= MINIMUM_FORMS_PER_INTERSECT) {
    return { ok: false, reason: `Unable to remove form, form intersect must have at least ${MINIMUM_FORMS_PER_INTERSECT} forms.` };
  }
  if (!target.forms.some((form) => form.formId === formId)) {
    return { ok: false, reason: "Unable to remove form, form not found in this intersect." };
  }
  return { ok: true, intersects: list.map((intersect) => (intersect === target ? { ...intersect, forms: intersect.forms.filter((form) => form.formId !== formId) } : intersect)) };
}
