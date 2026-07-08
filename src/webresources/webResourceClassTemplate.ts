import { TemplatePlaceholder } from "../context";

export interface WebResourceClassInputs {
  /** The class name the user entered (also the generated file name). */
  className: string;
  /** The logical name of the table the form belongs to (e.g. "account"). */
  entity: string;
  /** The form's display name as returned by Dataverse (may contain spaces). */
  formName: string;
  /** The form's id (GUID) in Dataverse. */
  formId: string;
  /**
   * The webresource library global — the webpack `output.library` value, which is
   * the solution prefix. The generated form handler is referenced as
   * `<libraryPrefix>.<ClassName>.<Function>`, so this must match the actual global
   * the bundle exposes on the form, or the handler won't resolve at runtime.
   */
  libraryPrefix: string;
  /** A unique GUID for the form-event handler (triggerId / handlerUniqueId). */
  triggerId: string;
  /** A unique id for the sample form notification so multiple classes don't collide. */
  notificationId: string;
}

/**
 * XrmDefinitelyTyped generates form types as `Form.<entity>.Main.<FormName>`, where
 * the form name is reduced to a valid TypeScript identifier (spaces and other
 * non-identifier characters removed). The raw Dataverse form name can contain
 * spaces/punctuation, so sanitize it the same way before it lands in a type
 * reference — otherwise the generated class fails to compile.
 */
export function sanitizeFormTypeName(formName: string): string {
  const cleaned = (formName ?? "").replace(/[^a-zA-Z0-9_]/g, "");
  if (!cleaned) {
    return "Information";
  }
  // A TS identifier can't start with a digit.
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/**
 * Build the placeholder replacements applied to the webresource class template.
 * Pure (no vscode dependency) so it can be unit-tested. Every token here must
 * exist in templates/webresources/class.tstemplate.
 */
export function buildWebResourceClassPlaceholders(inputs: WebResourceClassInputs): TemplatePlaceholder[] {
  return [
    { placeholder: "TableName", value: inputs.entity },
    { placeholder: "FormName", value: sanitizeFormTypeName(inputs.formName) },
    { placeholder: "ClassName", value: inputs.className },
    { placeholder: "FORMIDPLACEHOLDER", value: inputs.formId },
    { placeholder: "SOLUTIONPREFIX", value: inputs.libraryPrefix },
    { placeholder: "NEWGUID", value: inputs.triggerId },
    { placeholder: "NOTIFICATIONID", value: inputs.notificationId },
  ];
}
