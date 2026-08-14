// How Dataverse STORES the names we look rows up by — one place, unit-tested against the real values
// observed in an environment (#143, Move 3).
//
// Escaping (odata.ts) makes a filter safe; it does not make it CORRECT. Three times in one session a
// lookup failed because the stored value is not the value you passed in:
//
//   * a PCF control is stored PREFIXED with the publisher's customization prefix —
//     `dvpt_SampleNamespace.SampleControl`, not `SampleNamespace.SampleControl`;
//   * a plug-in trace log's `typename` is ASSEMBLY-QUALIFIED —
//     `Ns.Class, Assembly, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null`;
//   * a plug-in TYPE's `typename`, by contrast, is the plain type name and matches with `eq`.
//
// Each of those cost a live run to discover, and two of them cost more than one because the wrong
// assumption existed in BOTH the product and the e2e client — which then agreed with each other and
// were both wrong, so a successful operation read as "not there". Everything that needs one of these
// lookups now imports it from here, so there is a single definition to be right or wrong about.
//
// A `$filter` that cannot be an exact match returns candidates: the resource narrows server-side, and
// `matches` picks the row, so a suffix query can never grab a near-miss.

import { escapeODataString } from "./odata";

export interface RowLookup {
  /** The OData resource to GET. */
  resource: string;
  /** Whether a returned row's stored name is the one asked for. */
  matches: (storedName: string) => boolean;
}

/**
 * A PCF control by its manifest `<namespace>.<constructor>`.
 *
 * Stored prefixed with the publisher's customization prefix, which is NOT knowable from the manifest —
 * the solution's publisher decides it. Hence a suffix query rather than reading the prefix from
 * settings, which would break the moment the two differ.
 */
export function customControlLookup(controlName: string): RowLookup {
  return {
    resource: `customcontrols?$select=customcontrolid,name&$filter=endswith(name,'${escapeODataString(controlName)}')`,
    matches: (storedName) => storedName === controlName || storedName.endsWith(`_${controlName}`),
  };
}

/**
 * Plug-in trace logs for a type.
 *
 * `typename` carries the full assembly-qualified name, so `eq` on the plain type name never matches a
 * row that is right there.
 */
export function pluginTraceLogLookup(typeName: string): RowLookup {
  return {
    resource: `plugintracelogs?$select=plugintracelogid,typename&$filter=startswith(typename,'${escapeODataString(typeName)}')`,
    matches: (storedName) => storedName === typeName || storedName.startsWith(`${typeName},`),
  };
}

/**
 * A plug-in type by name. Stored as the plain type name — the one of the three that IS an exact match,
 * recorded here so nobody "fixes" it into a suffix query by pattern-matching on the others.
 */
export function pluginTypeLookup(typeName: string): RowLookup {
  return {
    resource: `plugintypes?$select=plugintypeid,typename&$filter=typename eq '${escapeODataString(typeName)}'`,
    matches: (storedName) => storedName === typeName,
  };
}

/** The first row from an OData response whose stored `name`/`typename` really is the one asked for. */
export function pickMatchingRow<T extends Record<string, unknown>>(rows: T[] | undefined, lookup: RowLookup, nameField: "name" | "typename"): T | undefined {
  return (rows ?? []).find((row) => lookup.matches(String(row?.[nameField] ?? "")));
}
