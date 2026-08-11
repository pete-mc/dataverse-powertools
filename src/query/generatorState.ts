// The generator's view-model (#238).
//
// Everything the webview renders is computed HERE, in a pure function, so the webview is a renderer
// with no query knowledge and the whole generator — labels, which fields a node has, which children it
// can take, which operators are offered — is unit-testable without a browser.
//
// Pure (no `vscode`) → unit-tested.

import { QueryDiagnostic } from "./diagnostics";
import { nodeAt } from "./edits";
import { serializeFetchXml, XmlFormat } from "./fetchXml";
import { ParameterType } from "./parameters";
import { QueryNode, attrBool } from "./queryModel";

/** FetchXML condition operators, grouped so the picker isn't a wall of 60 options. */
export const OPERATOR_GROUPS: readonly { label: string; operators: readonly string[] }[] = [
  { label: "Comparison", operators: ["eq", "ne", "gt", "ge", "lt", "le", "not-null", "null"] },
  { label: "Text", operators: ["like", "not-like", "begins-with", "not-begin-with", "ends-with", "not-end-with"] },
  { label: "Sets", operators: ["in", "not-in", "between", "not-between"] },
  {
    label: "Dates",
    operators: [
      "on",
      "on-or-before",
      "on-or-after",
      "today",
      "yesterday",
      "tomorrow",
      "this-week",
      "this-month",
      "this-year",
      "last-week",
      "last-month",
      "last-year",
      "next-week",
      "next-month",
      "next-year",
      "last-x-days",
      "next-x-days",
      "last-x-hours",
      "next-x-hours",
      "last-x-weeks",
      "next-x-weeks",
      "last-x-months",
      "next-x-months",
      "last-x-years",
      "next-x-years",
      "older-than-x-days",
      "older-than-x-months",
      "older-than-x-years",
    ],
  },
  { label: "User & team", operators: ["eq-userid", "ne-userid", "eq-userteams", "eq-useroruserteams", "eq-businessid", "ne-businessid"] },
  { label: "Hierarchy", operators: ["under", "not-under", "under-or-equal", "above", "above-or-equal"] },
];

export const ALL_OPERATORS: readonly string[] = OPERATOR_GROUPS.flatMap((group) => group.operators);

/** Operators that take no value at all — the value box is hidden for these. */
export const VALUELESS_OPERATORS: ReadonlySet<string> = new Set([
  "null",
  "not-null",
  "today",
  "yesterday",
  "tomorrow",
  "this-week",
  "this-month",
  "this-year",
  "last-week",
  "last-month",
  "last-year",
  "next-week",
  "next-month",
  "next-year",
  "eq-userid",
  "ne-userid",
  "eq-userteams",
  "eq-useroruserteams",
  "eq-businessid",
  "ne-businessid",
]);

export const AGGREGATE_FUNCTIONS: readonly string[] = ["count", "countcolumn", "sum", "avg", "min", "max"];
export const DATE_GROUPINGS: readonly string[] = ["day", "week", "month", "quarter", "year", "fiscal-period", "fiscal-year"];

export type FieldKind = "text" | "select" | "boolean" | "entity" | "attribute" | "number";

export interface FieldDescriptor {
  /** XML attribute name. */
  name: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  hint?: string;
}

/** The fields the generator offers per element. Anything not listed still round-trips — it shows in
 * the "other attributes" row as read-only, so an exotic query is never silently simplified. */
/* eslint-disable @typescript-eslint/naming-convention -- keys are FetchXML element and attribute
   names (`all-attributes`, `link-entity`, `link-type`); they are wire format, not our naming. */
const FIELDS: Record<string, readonly FieldDescriptor[]> = {
  fetch: [
    { name: "top", label: "Top", kind: "number", hint: "Maximum rows. Cannot be combined with paging." },
    { name: "distinct", label: "Distinct", kind: "boolean" },
    { name: "aggregate", label: "Aggregate", kind: "boolean", hint: "Every attribute must then aggregate or group." },
    { name: "returntotalrecordcount", label: "Return total count", kind: "boolean" },
    { name: "no-lock", label: "No lock", kind: "boolean" },
    { name: "page", label: "Page", kind: "number" },
    { name: "count", label: "Page size", kind: "number" },
  ],
  entity: [{ name: "name", label: "Table", kind: "entity" }],
  attribute: [
    { name: "name", label: "Column", kind: "attribute" },
    { name: "alias", label: "Alias", kind: "text" },
    { name: "aggregate", label: "Aggregate", kind: "select", options: AGGREGATE_FUNCTIONS },
    { name: "groupby", label: "Group by", kind: "boolean" },
    { name: "dategrouping", label: "Date grouping", kind: "select", options: DATE_GROUPINGS },
    { name: "distinct", label: "Distinct", kind: "boolean" },
  ],
  "all-attributes": [],
  order: [
    { name: "attribute", label: "Column", kind: "attribute" },
    { name: "alias", label: "Alias", kind: "text" },
    { name: "descending", label: "Descending", kind: "boolean" },
  ],
  filter: [{ name: "type", label: "Match", kind: "select", options: ["and", "or"] }],
  condition: [
    { name: "attribute", label: "Column", kind: "attribute" },
    { name: "operator", label: "Operator", kind: "select", options: ALL_OPERATORS },
    { name: "value", label: "Value", kind: "text", hint: "Use @name for a parameter." },
    { name: "entityname", label: "From alias", kind: "text", hint: "Alias of a link-entity to filter on." },
  ],
  value: [],
  "link-entity": [
    { name: "name", label: "Table", kind: "entity" },
    { name: "from", label: "From column", kind: "text" },
    { name: "to", label: "To column", kind: "attribute" },
    { name: "alias", label: "Alias", kind: "text" },
    { name: "link-type", label: "Join", kind: "select", options: ["inner", "outer", "any", "not any", "all", "not all", "exists", "in"] },
    { name: "intersect", label: "Intersect", kind: "boolean", hint: "Set for the intersect table of a many-to-many join." },
  ],
};

/** Which children each element may gain, in the order the Add menu shows them. */
const ADDABLE: Record<string, readonly string[]> = {
  fetch: ["entity"],
  entity: ["attribute", "all-attributes", "filter", "order", "link-entity"],
  "link-entity": ["attribute", "all-attributes", "filter", "order", "link-entity"],
  filter: ["condition", "filter"],
  condition: ["value"],
  attribute: [],
  order: [],
  value: [],
  "all-attributes": [],
};

/** Sensible defaults so an added node is immediately valid rather than blank. */
const DEFAULTS: Record<string, Record<string, string>> = {
  entity: { name: "account" },
  filter: { type: "and" },
  condition: { operator: "eq" },
  "link-entity": { "link-type": "inner" },
  order: {},
  attribute: {},
};
/* eslint-enable @typescript-eslint/naming-convention */

export interface TreeRow {
  path: number[];
  tag: string;
  /** Rendered label, e.g. "condition  statecode eq 0". */
  label: string;
  depth: number;
  /** True when this element isn't one the generator edits (a comment, an unknown tag). */
  readOnly: boolean;
}

export interface ParameterRow {
  name: string;
  type: ParameterType;
  /** The code expression it is bound to, absent for one typed in the generator. */
  expression?: string;
  value: string;
}

export interface GeneratorState {
  xml: string;
  tree: TreeRow[];
  selection: number[];
  selectedTag?: string;
  fields: { descriptor: FieldDescriptor; value: string }[];
  /** Attributes present on the selected node that the generator has no field for. */
  otherAttributes: { name: string; value: string }[];
  addable: readonly string[];
  canRemove: boolean;
  diagnostics: QueryDiagnostic[];
  parameters: ParameterRow[];
  /** Tables for the entity pickers; undefined until metadata loads. */
  tables?: { logicalName: string; displayName: string }[];
  /** Columns of the selected node's scope; undefined until metadata loads. */
  attributes?: { logicalName: string; displayName: string }[];
  readOnly: boolean;
  consumerLabel: string;
  title: string;
  dirty: boolean;
  operatorGroups: typeof OPERATOR_GROUPS;
}

export function fieldsFor(tag: string): readonly FieldDescriptor[] {
  return FIELDS[tag] ?? [];
}

export function addableFor(tag: string): readonly string[] {
  return ADDABLE[tag] ?? [];
}

export function defaultsFor(tag: string): Record<string, string> {
  return DEFAULTS[tag] ?? {};
}

/** The logical name of the table a node's columns come from — what the attribute picker needs. */
export function scopeEntity(root: QueryNode, path: readonly number[]): string | undefined {
  for (let depth = path.length; depth >= 0; depth--) {
    const node = nodeAt(root, path.slice(0, depth));
    if (node && (node.tag === "entity" || node.tag === "link-entity")) {
      return node.attrs.name;
    }
  }
  return undefined;
}

/** One-line summary of a node, so the tree reads like the query rather than like XML. */
export function labelFor(node: QueryNode): string {
  switch (node.tag) {
    case "fetch": {
      const bits = [node.attrs.top ? `top ${node.attrs.top}` : "", attrBool(node, "distinct") ? "distinct" : "", attrBool(node, "aggregate") ? "aggregate" : ""].filter(Boolean);
      return bits.join(" · ");
    }
    case "entity":
      return node.attrs.name ?? "(no table)";
    case "attribute": {
      const name = node.attrs.name ?? "(no column)";
      const aggregate = node.attrs.aggregate ? `${node.attrs.aggregate}(${name})` : name;
      return node.attrs.alias ? `${aggregate} as ${node.attrs.alias}` : aggregate;
    }
    case "all-attributes":
      return "all columns";
    case "order":
      return `${node.attrs.attribute ?? node.attrs.alias ?? "?"}${attrBool(node, "descending") ? " desc" : " asc"}`;
    case "filter":
      return (node.attrs.type ?? "and").toUpperCase();
    case "condition": {
      const attribute = node.attrs.entityname ? `${node.attrs.entityname}.${node.attrs.attribute ?? "?"}` : (node.attrs.attribute ?? "?");
      const operator = node.attrs.operator ?? "?";
      if (VALUELESS_OPERATORS.has(operator)) {
        return `${attribute} ${operator}`;
      }
      const values = node.children.filter((child) => child.tag === "value").map((child) => child.text ?? "");
      const value = values.length > 0 ? values.join(", ") : (node.attrs.value ?? "");
      return `${attribute} ${operator} ${value}`.trim();
    }
    case "value":
      return node.text ?? "";
    case "link-entity": {
      const join = node.attrs["link-type"] ?? "inner";
      const alias = node.attrs.alias ? ` as ${node.attrs.alias}` : "";
      return `${node.attrs.name ?? "?"}${alias} (${join}: ${node.attrs.from ?? "?"} → ${node.attrs.to ?? "?"})`;
    }
    case "#comment":
      return `comment${node.text ? `: ${node.text.trim()}` : ""}`;
    default:
      return node.tag;
  }
}

function flattenTree(node: QueryNode, path: number[], depth: number, rows: TreeRow[]): void {
  rows.push({ path: [...path], tag: node.tag, label: labelFor(node), depth, readOnly: node.tag === "#comment" || FIELDS[node.tag] === undefined });
  node.children.forEach((child, index) => flattenTree(child, [...path, index], depth + 1, rows));
}

export interface BuildStateInput {
  root: QueryNode;
  format: XmlFormat;
  selection: number[];
  diagnostics: QueryDiagnostic[];
  parameters: ParameterRow[];
  tables?: { logicalName: string; displayName: string }[];
  attributes?: { logicalName: string; displayName: string }[];
  readOnly: boolean;
  consumerLabel: string;
  title: string;
  dirty: boolean;
}

/** Assemble everything the webview needs for one render. */
export function buildState(input: BuildStateInput): GeneratorState {
  const tree: TreeRow[] = [];
  flattenTree(input.root, [], 0, tree);

  // A selection that no longer resolves (its node was removed) falls back to the root.
  const selected = nodeAt(input.root, input.selection) ? input.selection : [];
  const node = nodeAt(input.root, selected) ?? input.root;
  const descriptors = fieldsFor(node.tag);
  const known = new Set(descriptors.map((descriptor) => descriptor.name));

  return {
    xml: serializeFetchXml(input.root, input.format),
    tree,
    selection: selected,
    selectedTag: node.tag,
    fields: descriptors.map((descriptor) => ({ descriptor, value: node.attrs[descriptor.name] ?? "" })),
    otherAttributes: Object.entries(node.attrs)
      .filter(([name]) => !known.has(name))
      .map(([name, value]) => ({ name, value })),
    addable: addableFor(node.tag),
    canRemove: selected.length > 0,
    diagnostics: input.diagnostics,
    parameters: input.parameters,
    tables: input.tables,
    attributes: input.attributes,
    readOnly: input.readOnly,
    consumerLabel: input.consumerLabel,
    title: input.title,
    dirty: input.dirty,
    operatorGroups: OPERATOR_GROUPS,
  };
}
