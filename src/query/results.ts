// Flattening a Web API FetchXML response into a grid (#238).
//
// Two things make this more than Object.keys(). First, annotations: Dataverse returns an option set
// as `statecode: 0` plus `statecode@OData.Community.Display.V1.FormattedValue: "Active"`, and a grid
// showing `0` is useless — so the formatted value wins for display while the raw one stays available.
// Second, link-entity columns come back as `alias.attribute`, and aggregates as their alias, so the
// column set is discovered from the rows rather than assumed.
//
// Pure (no `vscode`) → unit-tested.

const FORMATTED_SUFFIX = "@OData.Community.Display.V1.FormattedValue";
const TOTAL_COUNT = "@Microsoft.Dynamics.CRM.totalrecordcount";
const MORE_RECORDS = "@Microsoft.Dynamics.CRM.morerecords";
const PAGING_COOKIE = "@Microsoft.Dynamics.CRM.fetchxmlpagingcookie";

export interface ResultColumn {
  /** Key into each row's `cells`. */
  key: string;
  /** Header text — the lookup-friendly name, e.g. `customerid` for `_customerid_value`. */
  label: string;
}

export interface ResultRow {
  cells: Record<string, string>;
  /** Raw values, for "copy as JSON" and for building a record URL. */
  raw: Record<string, unknown>;
}

export interface ResultTable {
  columns: ResultColumn[];
  rows: ResultRow[];
  totalRecordCount?: number;
  moreRecords?: boolean;
  pagingCookie?: string;
}

/** `_customerid_value` is how the Web API names a lookup's raw id; show it as `customerid`. */
function labelFor(key: string): string {
  const match = /^_(.+)_value$/.exec(key);
  return match ? match[1] : key;
}

function isAnnotation(key: string): boolean {
  return key.includes("@");
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/** Flatten a `{ value: [...] }` Web API response. */
export function flattenResults(payload: unknown): ResultTable {
  const body = (payload ?? {}) as Record<string, unknown>;
  const records = Array.isArray(body.value) ? (body.value as Record<string, unknown>[]) : [];

  const columns: ResultColumn[] = [];
  const seen = new Set<string>();
  const rows: ResultRow[] = [];

  for (const record of records) {
    const cells: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key.startsWith("@odata.") || isAnnotation(key)) {
        continue;
      }
      if (!seen.has(key)) {
        seen.add(key);
        columns.push({ key, label: labelFor(key) });
      }
      // A formatted value is what a user recognises; keep the raw one in `raw`.
      const formatted = record[`${key}${FORMATTED_SUFFIX}`];
      cells[key] = formatted === undefined ? displayValue(value) : displayValue(formatted);
    }
    rows.push({ cells, raw: record });
  }

  const table: ResultTable = { columns, rows };
  if (typeof body[TOTAL_COUNT] === "number") {
    table.totalRecordCount = body[TOTAL_COUNT] as number;
  }
  if (typeof body[MORE_RECORDS] === "boolean") {
    table.moreRecords = body[MORE_RECORDS] as boolean;
  }
  if (typeof body[PAGING_COOKIE] === "string") {
    table.pagingCookie = body[PAGING_COOKIE] as string;
  }
  return table;
}

/** Rows as CSV, for the results view's copy action. */
export function resultsToCsv(table: ResultTable): string {
  const escape = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const header = table.columns.map((column) => escape(column.label)).join(",");
  const lines = table.rows.map((row) => table.columns.map((column) => escape(row.cells[column.key] ?? "")).join(","));
  return [header, ...lines].join("\n");
}
