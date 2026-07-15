// Pure codegen for a typed portal Web API client (#150, issue #4 — typed Portal
// Web API). A `*.portalapi.json` definition (entity set + typed fields) generates
// typed CRUD helpers over the documented portal Web API — `webapi.safeAjax` (the
// CSRF wrapper) against `/_api/<entityset>` — so portal JS hitting Dataverse tables
// gets IntelliSense instead of untyped string-bashing. Pattern is verbatim from:
//   https://learn.microsoft.com/power-pages/configure/write-update-delete-operations
//   https://learn.microsoft.com/power-pages/configure/web-api-http-requests-handle-errors
// No `vscode` import → unit-tested.

export interface PortalWebApiDefinition {
  /** The Dataverse entity set name, e.g. "accounts" — the `/_api/<entitySet>` path. */
  entitySet: string;
  /** The generated record interface name, e.g. "Account". Defaults from entitySet. */
  typeName?: string;
  /** Field logical name → TS type (e.g. "string", "number", "boolean"). */
  fields?: Record<string, string>;
}

export const PORTAL_API_FILE_SUFFIX = ".portalapi.json";

function pascal(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ""));
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Default a record type name from an entity set (drop a trailing plural "s"). */
export function defaultTypeName(entitySet: string): string {
  const singular = entitySet.replace(/ies$/i, "y").replace(/s$/i, "");
  return pascal(singular || entitySet);
}

export function newPortalWebApiDefinition(entitySet: string): PortalWebApiDefinition {
  return { entitySet, typeName: defaultTypeName(entitySet), fields: { name: "string" } };
}

function fieldLines(fields: Record<string, string> | undefined): string {
  const entries = Object.entries(fields ?? {});
  if (entries.length === 0) {
    return "  [field: string]: unknown;";
  }
  return entries.map(([key, type]) => `  ${key}?: ${type};`).join("\n");
}

/** Generate the typed portal Web API CRUD client module for a definition. */
export function generatePortalWebApiClient(def: PortalWebApiDefinition): string {
  const type = def.typeName ? pascal(def.typeName) : defaultTypeName(def.entitySet);
  const set = def.entitySet;

  return `// Auto-generated typed portal Web API client for "${set}".
// Regenerate from ${set}${PORTAL_API_FILE_SUFFIX} when the definition changes.
// Uses the portal Web API wrapper 'webapi.safeAjax' (handles the CSRF token).

/* eslint-disable */
declare const webapi: any;

export interface ${type} {
${fieldLines(def.fields)}
}

/** Create a ${type}; resolves with the new record's id. */
export function create${type}(record: ${type}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    webapi.safeAjax({
      type: "POST",
      url: "/_api/${set}",
      contentType: "application/json",
      data: JSON.stringify(record),
      success: (_res: unknown, _status: unknown, xhr: { getResponseHeader(name: string): string }) => resolve(xhr.getResponseHeader("entityid")),
      error: (xhr: unknown) => reject(xhr),
    });
  });
}

/** Retrieve a single ${type} by id (optionally an OData \\$select). */
export function retrieve${type}(id: string, select?: string): Promise<${type}> {
  return new Promise<${type}>((resolve, reject) => {
    webapi.safeAjax({
      type: "GET",
      url: "/_api/${set}(" + id + ")" + (select ? "?\\$select=" + select : ""),
      contentType: "application/json",
      success: (res: ${type}) => resolve(res),
      error: (xhr: unknown) => reject(xhr),
    });
  });
}

/** Retrieve multiple ${type} records (pass an OData query, e.g. "?\\$select=name&\\$top=10"). */
export function retrieveMultiple${type}(query = ""): Promise<{ value: ${type}[] }> {
  return new Promise<{ value: ${type}[] }>((resolve, reject) => {
    webapi.safeAjax({
      type: "GET",
      url: "/_api/${set}" + query,
      contentType: "application/json",
      success: (res: { value: ${type}[] }) => resolve(res),
      error: (xhr: unknown) => reject(xhr),
    });
  });
}

/** Update a ${type} by id (partial). */
export function update${type}(id: string, record: ${type}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    webapi.safeAjax({
      type: "PATCH",
      url: "/_api/${set}(" + id + ")",
      contentType: "application/json",
      data: JSON.stringify(record),
      success: () => resolve(),
      error: (xhr: unknown) => reject(xhr),
    });
  });
}

/** Delete a ${type} by id. */
export function delete${type}(id: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    webapi.safeAjax({
      type: "DELETE",
      url: "/_api/${set}(" + id + ")",
      contentType: "application/json",
      success: () => resolve(),
      error: (xhr: unknown) => reject(xhr),
    });
  });
}
`;
}

export function portalWebApiClientFileName(def: PortalWebApiDefinition): string {
  return `${def.entitySet}.webapi.ts`;
}
