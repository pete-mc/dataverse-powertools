// Pure codegen for a typed front-end client that calls a Power Pages Server Logic
// via `shell.safeAjax` (#150, issue #4). A `*.serverlogic.json` definition (name +
// HTTP method + request/response field types) is the source of truth; this emits a
// typed request/response + an async wrapper that calls `/_api/serverlogics/<name>`
// with CSRF handled by `shell.safeAjax`. Shared with the backend via the same
// definition, this closes the untyped string-bashing gap on portal JS. No `vscode`.

export type ServerLogicMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A `*.serverlogic.json` definition. Field values are raw TS types (e.g. "string",
 * "number", "boolean", "string[]", "unknown") so the client is flexible. */
export interface ServerLogicDefinition {
  /** The Server Logic name — the `/_api/serverlogics/<name>` resource. */
  name: string;
  description?: string;
  /** HTTP verb the logic handles (its top-level get()/post()/…). Defaults to POST. */
  method?: ServerLogicMethod;
  /** Request fields → TS type. */
  request?: Record<string, string>;
  /** Response fields → TS type. */
  response?: Record<string, string>;
}

export const SERVER_LOGIC_FILE_SUFFIX = ".serverlogic.json";

function pascal(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ""));
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function camel(name: string): string {
  const p = pascal(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function fields(record: Record<string, string> | undefined, fallbackComment: string): string {
  const entries = Object.entries(record ?? {});
  if (entries.length === 0) {
    return `  ${fallbackComment}`;
  }
  return entries.map(([key, type]) => `  ${key}: ${type};`).join("\n");
}

/** Seed a minimal valid definition. Field names are PascalCase by convention. */
export function newServerLogicDefinition(name: string): ServerLogicDefinition {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    name,
    description: "",
    method: "POST",
    request: { InputValue: "string" },
    response: { OutputValue: "string" },
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

/** Generate the typed TS client module for a Server Logic definition. */
export function generateServerLogicClient(def: ServerLogicDefinition): string {
  const type = pascal(def.name);
  const fn = camel(def.name);
  const method = def.method ?? "POST";
  const sendsBody = method !== "GET" && method !== "DELETE";

  return `// Auto-generated typed client for the "${def.name}" Power Pages Server Logic.
// Regenerate from ${def.name}${SERVER_LOGIC_FILE_SUFFIX} when the definition changes.
// Requires the Power Pages shell (shell.safeAjax handles the CSRF token).

/* eslint-disable */
declare const shell: any;

export interface ${type}Request {
${fields(def.request, "// (no request fields)")}
}

export interface ${type}Response {
${fields(def.response, "// (no response fields)")}
}

/** Call the "${def.name}" Server Logic (${method} /_api/serverlogics/${def.name}). */
export function ${fn}(request: ${type}Request): Promise<${type}Response> {
  return new Promise<${type}Response>((resolve, reject) => {
    shell.safeAjax({
      type: "${method}",
      url: "/_api/serverlogics/${def.name}",
      contentType: "application/json",${sendsBody ? "\n      data: JSON.stringify(request)," : ""}
      success: (response: ${type}Response) => resolve(response),
      error: (xhr: unknown) => reject(xhr),
    });
  });
}
`;
}

/** Output file name for a definition's generated client. */
export function serverLogicClientFileName(def: ServerLogicDefinition): string {
  return `${def.name}.client.ts`;
}
