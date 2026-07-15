// Pure validation for a Custom API definition (#142, issues #1/#6). No `vscode`
// import — unit-testable. Catches the errors the platform would otherwise reject
// at deploy time, with a readable message instead of a cryptic HTTP fault. Rules
// here are only ones that are unambiguously correct (no fragile guesses), so a
// clean result is a strong signal the definition will deploy.

import { CustomApiDefinition, CUSTOM_API_PARAMETER_TYPES, CustomApiRequestParameter, CustomApiResponseProperty } from "./definition";

const VALID_BINDINGS = ["Global", "Entity", "EntityCollection"];
// Dataverse unique/schema names: start with a letter, then letters/digits/underscore.
const UNIQUE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Validate a Custom API definition. Returns a list of human-readable error
 * messages; an empty array means the definition is structurally valid.
 */
export function validateCustomApiDefinition(def: CustomApiDefinition): string[] {
  const errors: string[] = [];

  requireField(errors, "uniqueName", def.uniqueName);
  requireField(errors, "name", def.name);
  requireField(errors, "displayName", def.displayName);
  requireField(errors, "pluginTypeName", def.pluginTypeName);

  if (def.uniqueName && !UNIQUE_NAME_PATTERN.test(def.uniqueName)) {
    errors.push(`uniqueName "${def.uniqueName}" must start with a letter and contain only letters, digits, or underscores.`);
  }

  if (!VALID_BINDINGS.includes(def.binding)) {
    errors.push(`binding "${def.binding}" is invalid — must be one of ${VALID_BINDINGS.join(", ")}.`);
  } else if (def.binding === "Global") {
    if (def.boundEntityLogicalName) {
      errors.push(`boundEntityLogicalName must not be set for a Global binding (it applies only to Entity / EntityCollection).`);
    }
  } else if (!def.boundEntityLogicalName) {
    errors.push(`boundEntityLogicalName is required when binding is "${def.binding}".`);
  }

  validateMembers(errors, "requestParameters", def.requestParameters);
  validateMembers(errors, "responseProperties", def.responseProperties);

  return errors;
}

function requireField(errors: string[], field: string, value: string | undefined): void {
  if (!value || !value.trim()) {
    errors.push(`${field} is required.`);
  }
}

function validateMembers(errors: string[], label: string, members: (CustomApiRequestParameter | CustomApiResponseProperty)[] | undefined): void {
  if (!members) {
    return;
  }

  const seen = new Set<string>();
  for (const member of members) {
    const where = `${label} "${member.uniqueName || "(unnamed)"}"`;

    if (!member.uniqueName || !member.uniqueName.trim()) {
      errors.push(`${label}: every entry needs a uniqueName.`);
    } else {
      if (!UNIQUE_NAME_PATTERN.test(member.uniqueName)) {
        errors.push(`${where}: uniqueName must start with a letter and contain only letters, digits, or underscores.`);
      }
      const key = member.uniqueName.toLowerCase();
      if (seen.has(key)) {
        errors.push(`${label}: duplicate uniqueName "${member.uniqueName}" (names must be unique, case-insensitively).`);
      }
      seen.add(key);
    }

    if (!CUSTOM_API_PARAMETER_TYPES.includes(member.type)) {
      errors.push(`${where}: type "${member.type}" is not a valid Custom API parameter type.`);
    }
  }
}
