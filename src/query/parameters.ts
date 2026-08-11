// Query parameters: where the `@token` placeholders sit, what type they are, and how a prompted
// value becomes safe FetchXML (#238).
//
// The nice property of detecting queries in place is that a parameter's type does not have to be
// declared — the condition it sits in names the attribute, and the attribute's metadata gives the
// type. `<condition attribute="accountid" operator="eq" value="@accountId" />` is a Uniqueidentifier
// whether or not anyone said so, which is what lets the run prompt validate properly.
//
// Pure (no `vscode`) → unit-tested.

import { replaceTokens } from "./holes";
import { MetadataLookup } from "./metadata/cache";
import { QueryNode, walk } from "./queryModel";

export type ParameterType = "guid" | "number" | "datetime" | "boolean" | "string";

export interface ParameterUsage {
  /** Logical name of the entity/link-entity the condition sits in, when it can be determined. */
  entity?: string;
  attribute?: string;
  operator?: string;
}

export interface QueryParameter {
  name: string;
  token: string;
  /** The code expression this parameter came from, absent for one typed in the generator. */
  expression?: string;
  usages: ParameterUsage[];
}

/** Operators whose value is a COUNT, not a date — `last-x-days` takes 7, not a timestamp. The
 * single most likely thing to get wrong when inferring a type from a date attribute. */
const COUNT_OPERATORS = /-x-(days|hours|weeks|months|years)$|^(last|next)-x-/;

const DATE_OPERATORS = new Set(["on", "on-or-before", "on-or-after"]);

const ATTRIBUTE_TYPE_MAP: Record<string, ParameterType> = {
  uniqueidentifier: "guid",
  lookup: "guid",
  customer: "guid",
  owner: "guid",
  integer: "number",
  bigint: "number",
  decimal: "number",
  double: "number",
  money: "number",
  picklist: "number",
  state: "number",
  status: "number",
  datetime: "datetime",
  boolean: "boolean",
  string: "string",
  memo: "string",
};

/** Tokens appearing in this node's own value(s). */
function tokensOfCondition(node: QueryNode, names: readonly string[]): string[] {
  const haystack = [node.attrs.value ?? "", ...node.children.filter((child) => child.tag === "value").map((child) => child.text ?? "")].join(" ");
  return names.filter((name) => {
    let found = false;
    replaceTokens(haystack, (candidate) => {
      if (candidate === name) {
        found = true;
      }
      return undefined;
    });
    return found;
  });
}

/** The logical name of the nearest enclosing entity/link-entity. */
function enclosingEntity(parents: readonly QueryNode[]): string | undefined {
  for (let i = parents.length - 1; i >= 0; i--) {
    if (parents[i].tag === "entity" || parents[i].tag === "link-entity") {
      return parents[i].attrs.name;
    }
  }
  return undefined;
}

/**
 * Collect the parameters of a query in document order, together with every place each is used —
 * a parameter used in two conditions is prompted for once and validated against both.
 */
export function collectParameters(root: QueryNode, tokenNames: readonly string[], expressions: Readonly<Record<string, string>> = {}): QueryParameter[] {
  const byName = new Map<string, QueryParameter>();

  const record = (name: string, usage: ParameterUsage): void => {
    const existing = byName.get(name);
    if (existing) {
      existing.usages.push(usage);
      return;
    }
    byName.set(name, { name, token: `@${name}`, expression: expressions[name], usages: [usage] });
  };

  walk(root, (node, parents) => {
    if (node.tag === "condition") {
      for (const name of tokensOfCondition(node, tokenNames)) {
        record(name, {
          // `entityname` on a condition points at a link-entity alias, which is a better answer
          // than the enclosing scope when present.
          entity: node.attrs.entityname ?? enclosingEntity(parents),
          attribute: node.attrs.attribute,
          operator: node.attrs.operator,
        });
      }
      return;
    }
    // A token somewhere unusual (an entity name, an alias) is still a parameter — it just has no
    // attribute to infer a type from.
    for (const value of Object.values(node.attrs)) {
      for (const name of tokenNames) {
        replaceTokens(value, (candidate) => {
          if (candidate === name && !byName.has(name)) {
            record(name, {});
          }
          return undefined;
        });
      }
    }
  });

  // Anything declared in code but no longer used in the XML is intentionally absent — the user
  // deleted that condition in the generator.
  return [...byName.values()];
}

/**
 * Infer a parameter's type. Metadata is authoritative; without it we fall back to conservative
 * naming/operator heuristics, which is enough to validate a guid or a count.
 */
export function inferParameterType(parameter: QueryParameter, metadata?: MetadataLookup): ParameterType {
  for (const usage of parameter.usages) {
    if (usage.operator && COUNT_OPERATORS.test(usage.operator)) {
      return "number";
    }
    const declared = usage.entity && usage.attribute ? metadata?.attributeType(usage.entity, usage.attribute) : undefined;
    const mapped = declared ? ATTRIBUTE_TYPE_MAP[declared.toLowerCase()] : undefined;
    if (mapped) {
      return mapped;
    }
  }
  for (const usage of parameter.usages) {
    if (usage.operator && DATE_OPERATORS.has(usage.operator)) {
      return "datetime";
    }
    if (usage.attribute && looksLikeIdColumn(usage.attribute)) {
      return "guid";
    }
  }
  return "string";
}

/** English words ending in "id" that are plausible column names — `valid` is not a GUID. */
const NOT_ID_COLUMNS = new Set(["valid", "invalid", "liquid", "hybrid", "rapid", "solid", "avoid", "candid"]);

/**
 * Dataverse names key and lookup columns by appending `id` (`accountid`, `customerid`), so the
 * suffix is a strong signal. Only used when metadata has NOT loaded, and only to pick the prompt's
 * validation — metadata overrides it — so the odd false positive costs a stricter prompt, nothing more.
 */
function looksLikeIdColumn(attribute: string): boolean {
  const name = attribute.toLowerCase();
  return name.endsWith("id") && name.length > 4 && !NOT_ID_COLUMNS.has(name);
}

const GUID_PATTERN = /^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$/;

/** Validate a prompted value; returns a message when it is wrong, undefined when it is fine. */
export function validateParameterValue(type: ParameterType, raw: string): string | undefined {
  const value = raw.trim();
  if (value.length === 0) {
    return "Enter a value.";
  }
  switch (type) {
    case "guid":
      return GUID_PATTERN.test(value) ? undefined : "Enter a GUID, e.g. 00000000-0000-0000-0000-000000000000.";
    case "number":
      return /^-?\d+(\.\d+)?$/.test(value) ? undefined : "Enter a number.";
    case "datetime":
      return Number.isNaN(new Date(value).getTime()) ? "Enter a date, e.g. 2026-01-31 or 2026-01-31T09:00:00Z." : undefined;
    case "boolean":
      return /^(true|false|0|1)$/i.test(value) ? undefined : "Enter true or false.";
    default:
      return undefined;
  }
}

/**
 * Canonicalise a prompted value for FetchXML. Dates become UTC because FetchXML compares dates in
 * UTC — passing a local-time string is the classic silent wrong-results bug.
 */
export function normalizeParameterValue(type: ParameterType, raw: string): string {
  const value = raw.trim();
  switch (type) {
    case "guid":
      return value.replace(/[{}]/g, "").toLowerCase();
    case "boolean":
      return /^(true|1)$/i.test(value) ? "1" : "0";
    case "datetime": {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : `${parsed.toISOString().slice(0, 19)}Z`;
    }
    default:
      return value;
  }
}

/** Escape BOTH quote styles: a token is substituted blind, without knowing which delimiter
 * surrounds it, so escaping only one of them would let a value break out of its attribute. */
function escapeSubstitutedValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Substitute prompted values into the tokenized XML, ready to run. Values are XML-escaped on the way
 * in — the reason a run can't be broken (or abused) by a value containing a quote.
 */
export function substituteParameters(xml: string, values: Readonly<Record<string, string>>): string {
  return replaceTokens(xml, (name) => {
    const value = values[name];
    return value === undefined ? undefined : escapeSubstitutedValue(value);
  });
}
