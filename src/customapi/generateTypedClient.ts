// Pure codegen for a typed TypeScript client that calls a Custom API from a
// web resource / PCF control via `Xrm.WebApi.online.execute` (#142, issue #5).
// From the same definition that generates the C# handler and the metadata deploy,
// this emits a strongly-typed request/response + an `execute` wrapper, so a form
// script gets IntelliSense and compile-time safety instead of hand-rolling the
// `getMetadata()` shape. No `vscode` import → unit-testable.

import { CustomApiDefinition, CustomApiParameterType } from "./definition";
import { splitPluginTypeName } from "./generateHandler";

/* eslint-disable @typescript-eslint/naming-convention */
/** The TypeScript type each Custom API parameter surfaces as in the client. */
const TS_TYPES: Record<CustomApiParameterType, string> = {
  Boolean: "boolean",
  DateTime: "Date",
  Decimal: "number",
  Entity: "unknown",
  EntityCollection: "unknown[]",
  EntityReference: "{ id: string; entityType: string }",
  Float: "number",
  Integer: "number",
  Money: "number",
  Picklist: "number",
  String: "string",
  StringArray: "string[]",
  Guid: "string",
};

/** The OData/Edm typeName Xrm.WebApi expects in parameterTypes.getMetadata(). */
const EDM_TYPES: Record<CustomApiParameterType, string> = {
  Boolean: "Edm.Boolean",
  DateTime: "Edm.DateTimeOffset",
  Decimal: "Edm.Decimal",
  Entity: "mscrm.crmbaseentity",
  EntityCollection: "Collection(mscrm.crmbaseentity)",
  EntityReference: "mscrm.crmbaseentity",
  Float: "Edm.Double",
  Integer: "Edm.Int32",
  Money: "Edm.Decimal",
  Picklist: "Edm.Int32",
  String: "Edm.String",
  StringArray: "Collection(Edm.String)",
  Guid: "Edm.Guid",
};
/* eslint-enable @typescript-eslint/naming-convention */

/** Xrm structuralProperty: 1 = PrimitiveType, 4 = Collection, 5 = EntityType. */
export function structuralProperty(type: CustomApiParameterType): number {
  if (type === "StringArray" || type === "EntityCollection") {
    return 4;
  }
  if (type === "Entity" || type === "EntityReference") {
    return 5;
  }
  return 1;
}

export function customApiParameterTsType(type: CustomApiParameterType): string {
  return TS_TYPES[type];
}

export function customApiParameterEdmType(type: CustomApiParameterType): string {
  return EDM_TYPES[type];
}

/** camelCase the operation name for the exported function (e.g. sample_DoThing → sampleDoThing). */
function functionName(uniqueName: string): string {
  const cleaned = uniqueName.replace(/[^A-Za-z0-9]+(.)?/g, (_m, chr: string | undefined) => (chr ? chr.toUpperCase() : ""));
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

/**
 * Generate a typed TS client module for a Custom API definition. `operationType`
 * is 0 for an Action and 1 for a Function.
 */
export function generateTypedClient(def: CustomApiDefinition): string {
  const { className } = splitPluginTypeName(def.pluginTypeName);
  const requestType = `${className}Request`;
  const responseType = `${className}Response`;
  const fn = functionName(def.uniqueName);
  const operationType = def.isFunction ? 1 : 0;

  const requestFields = def.requestParameters.map((p) => `  ${p.uniqueName}${p.isOptional ? "?" : ""}: ${customApiParameterTsType(p.type)};`).join("\n");
  const responseFields = def.responseProperties.map((p) => `  ${p.uniqueName}: ${customApiParameterTsType(p.type)};`).join("\n");
  const parameterTypes = def.requestParameters
    .map((p) => `        ${p.uniqueName}: { typeName: "${customApiParameterEdmType(p.type)}", structuralProperty: ${structuralProperty(p.type)} },`)
    .join("\n");

  return `// Auto-generated typed client for the "${def.uniqueName}" Custom API.
// Regenerate from ${def.uniqueName}.customapi.json when the definition changes.
// Requires the Xrm client API (web resource / model-driven form or PCF host).

/* eslint-disable */
declare const Xrm: any;

export interface ${requestType} {
${requestFields || "  // (no request parameters)"}
}

export interface ${responseType} {
${responseFields || "  // (no response properties)"}
}

/** Call the "${def.uniqueName}" Custom API (${def.isFunction ? "Function" : "Action"}). */
export async function ${fn}(request: ${requestType}): Promise<${responseType}> {
  const payload: any = { ...request };
  payload.getMetadata = () => ({
    boundParameter: null,
    parameterTypes: {
${parameterTypes || "      // (no request parameters)"}
    },
    operationType: ${operationType},
    operationName: "${def.uniqueName}",
  });

  const response = await Xrm.WebApi.online.execute(payload);
  if (response.ok === false) {
    throw new Error("${def.uniqueName} failed: " + response.status + " " + response.statusText);
  }
  ${def.responseProperties.length > 0 ? "return (await response.json()) as " + responseType + ";" : "return {} as " + responseType + ";"}
}
`;
}

/** Output file name for a definition's generated TS client. */
export function customApiClientFileName(def: CustomApiDefinition): string {
  const { className } = splitPluginTypeName(def.pluginTypeName);
  return `${className}.client.ts`;
}
