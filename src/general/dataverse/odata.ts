// Pure OData helpers for the Dataverse Web API. Kept vscode-free and unit-tested — the
// escaping here guards every `$filter=... eq '<value>'` we build against names containing a
// single quote (which would otherwise break the query, or worse, alter its meaning). This
// used to be copy-pasted into each getDataverse*/register* file; consolidated so there's one
// definition to reason about and test (#143).

/**
 * Escape a string for safe interpolation inside an OData single-quoted literal.
 *
 * OData escapes a single quote by doubling it (`O'Brien` → `O''Brien`). Callers still supply
 * the surrounding quotes: `` `name eq '${escapeODataString(name)}'` ``.
 */
export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}
