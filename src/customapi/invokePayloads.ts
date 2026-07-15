// Pure builders for invoking a Custom API from the editor (#142, issue #4). Turn
// raw string inputs (from prompts) into typed values, and build the OData execute
// request — a POST body for an Action, or a parameter-aliased URL for a Function.
// No `vscode` / no network → unit-tested; invokeCustomApi.ts does the HTTP.

import { CustomApiDefinition, CustomApiParameterType, CustomApiRequestParameter } from "./definition";

/** Coerce a raw string (from a prompt) into the JSON value for a parameter type.
 * Complex types (Entity/EntityReference/EntityCollection) expect JSON text. */
export function coerceParameterValue(type: CustomApiParameterType, raw: string): unknown {
  const value = raw.trim();
  switch (type) {
    case "Boolean":
      return /^(true|1|yes)$/i.test(value);
    case "Integer":
    case "Picklist":
      return Number.parseInt(value, 10);
    case "Decimal":
    case "Float":
    case "Money":
      return Number.parseFloat(value);
    case "StringArray":
      return value === "" ? [] : value.split(",").map((s) => s.trim());
    case "Entity":
    case "EntityReference":
    case "EntityCollection":
      return JSON.parse(value);
    case "DateTime":
    case "Guid":
    case "String":
    default:
      return value;
  }
}

/** Which request parameters have a (non-empty) provided value. */
function providedParameters(def: CustomApiDefinition, values: Record<string, string>): CustomApiRequestParameter[] {
  return def.requestParameters.filter((p) => {
    const v = values[p.uniqueName];
    return v !== undefined && v !== "";
  });
}

/** Build the POST body for an Action invoke: { ParamName: typedValue, … }. */
export function buildActionInvokeBody(def: CustomApiDefinition, values: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const p of providedParameters(def, values)) {
    body[p.uniqueName] = coerceParameterValue(p.type, values[p.uniqueName]);
  }
  return body;
}

/** OData literal for a Function URL parameter alias value. */
function odataLiteral(type: CustomApiParameterType, coerced: unknown): string {
  if (type === "String" || type === "Guid" || type === "DateTime") {
    return `'${String(coerced).replace(/'/g, "''")}'`;
  }
  if (type === "Boolean") {
    return coerced ? "true" : "false";
  }
  return JSON.stringify(coerced);
}

/** Build the relative URL for a Function invoke, e.g.
 * `sample_Do(Name=@p1)?@p1='x'`. Global (unbound) only. */
export function buildFunctionInvokeUrl(def: CustomApiDefinition, values: Record<string, string>): string {
  const params = providedParameters(def, values);
  if (params.length === 0) {
    return `${def.uniqueName}()`;
  }
  const signature = params.map((p, i) => `${p.uniqueName}=@p${i + 1}`).join(",");
  const query = params.map((p, i) => `@p${i + 1}=${encodeURIComponent(odataLiteral(p.type, coerceParameterValue(p.type, values[p.uniqueName])))}`).join("&");
  return `${def.uniqueName}(${signature})?${query}`;
}
