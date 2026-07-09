// Pure parsers for `pac` CLI output — no `vscode`/`child_process`, so they unit-test
// without an editor or a live environment.
//
// The portal commands used to reverse-engineer pac's human-readable table by
// whitespace-splitting and index arithmetic, which broke the moment a value
// contained a space (e.g. an environment display name like "Contoso Ltd") or pac
// nudged its column widths. pac's `auth list` / `pages list` verbs do NOT support
// `--json` (as of pac 2.8.x — only some verbs like `org list` do), so instead of
// scraping we anchor on the documented column HEADERS: pac pads every column to its
// widest cell and prints each header at that column's start offset, so slicing data
// rows at the header offsets is stable regardless of spacing or in-cell spaces.

export interface PacTableRow {
  [header: string]: string;
}

interface Column {
  name: string;
  start: number;
}

/**
 * Find `header` in `line` as a standalone column label — bounded by whitespace (or
 * the line edges) and not overlapping a span already claimed by a longer header —
 * and return its start offset, or -1. The boundary check stops "Name" from matching
 * inside "Friendly Name" and the claimed-span check stops it from matching the tail
 * of a longer header that was located first.
 */
function indexOfHeader(line: string, header: string, claimed: Array<[number, number]>): number {
  let from = 0;
  for (;;) {
    const idx = line.indexOf(header, from);
    if (idx === -1) {
      return -1;
    }
    const before = idx === 0 ? " " : line[idx - 1];
    const afterIdx = idx + header.length;
    const after = afterIdx >= line.length ? " " : line[afterIdx];
    const overlapsClaimed = claimed.some(([s, e]) => idx < e && afterIdx > s);
    if (before === " " && after === " " && !overlapsClaimed) {
      return idx;
    }
    from = idx + 1;
  }
}

/** Locate the start offset of each expected header present in the header line. */
function locateColumns(headerLine: string, headers: string[]): Column[] {
  const claimed: Array<[number, number]> = [];
  const found: Column[] = [];
  // Longest labels first so "Friendly Name" claims its span before "Name" is sought.
  for (const name of [...headers].sort((a, b) => b.length - a.length)) {
    const start = indexOfHeader(headerLine, name, claimed);
    if (start === -1) {
      continue;
    }
    claimed.push([start, start + name.length]);
    found.push({ name, start });
  }
  return found.sort((a, b) => a.start - b.start);
}

function sliceRow(line: string, columns: Column[]): PacTableRow {
  const row: PacTableRow = {};
  for (let i = 0; i < columns.length; i++) {
    const start = columns[i].start;
    const end = i + 1 < columns.length ? columns[i + 1].start : line.length;
    row[columns[i].name] = line.slice(start, end).trim();
  }
  return row;
}

/**
 * Parse a pac fixed-width table into row objects keyed by header. `headers` is the
 * set of expected column labels; any not found are skipped (so a renamed or extra
 * column doesn't break the rest). Returns [] if no header line is found.
 */
export function parsePacTable(output: string, headers: string[]): PacTableRow[] {
  const lines = output.split(/\r?\n/);
  const headerLineIndex = lines.findIndex((line) => headers.filter((h) => indexOfHeader(line, h, []) !== -1).length >= 2);
  if (headerLineIndex === -1) {
    return [];
  }
  const columns = locateColumns(lines[headerLineIndex], headers);
  if (columns.length === 0) {
    return [];
  }
  const rows: PacTableRow[] = [];
  for (const line of lines.slice(headerLineIndex + 1)) {
    if (line.trim().length === 0) {
      continue;
    }
    rows.push(sliceRow(line, columns));
  }
  return rows;
}

export interface PacAuthProfile {
  index?: number;
  active: boolean;
  name: string;
  environmentUrl: string;
}

// Documented `pac auth list` columns, left-to-right.
const AUTH_LIST_HEADERS = ["Index", "Active", "Kind", "Name", "User", "Cloud", "Type", "Environment", "Environment Url"];

export function parsePacAuthList(output: string): PacAuthProfile[] {
  return parsePacTable(output, AUTH_LIST_HEADERS).map((row) => {
    const rawIndex = (row["Index"] ?? "").replace(/[[\]]/g, "");
    const parsedIndex = Number.parseInt(rawIndex, 10);
    return {
      index: Number.isNaN(parsedIndex) ? undefined : parsedIndex,
      active: row["Active"] === "*",
      name: row["Name"] ?? "",
      environmentUrl: row["Environment Url"] ?? "",
    };
  });
}

/**
 * Find the auth profile whose environment matches `environmentUrl` (host-insensitive
 * to a trailing slash / scheme differences). Returns the matching profile, or
 * undefined if none line up.
 */
export function findAuthProfileForUrl(profiles: PacAuthProfile[], environmentUrl: string): PacAuthProfile | undefined {
  const normalize = (value: string): string =>
    value
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  const target = normalize(environmentUrl);
  if (!target) {
    return undefined;
  }
  return profiles.find((profile) => {
    const candidate = normalize(profile.environmentUrl);
    return candidate.length > 0 && (candidate === target || candidate.includes(target) || target.includes(candidate));
  });
}

export interface PacPage {
  websiteId: string;
  friendlyName: string;
}

// `pac pages list` column spellings seen across pac versions. Only the two fields we
// need — the website id (passed to `pac pages download -id`) and the friendly name.
const PAGES_LIST_HEADERS = ["Index", "Friendly Name", "Name", "WebSiteId", "Website Id", "Data Model", "DataModel", "Data Model Version"];

export function parsePacPagesList(output: string): PacPage[] {
  return parsePacTable(output, PAGES_LIST_HEADERS)
    .map((row) => ({
      websiteId: row["WebSiteId"] ?? row["Website Id"] ?? "",
      friendlyName: row["Friendly Name"] ?? row["Name"] ?? "",
    }))
    .filter((page) => page.websiteId.length > 0);
}
