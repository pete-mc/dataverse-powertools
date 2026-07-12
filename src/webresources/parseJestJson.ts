// Pure parser for `jest --json --testLocationInResults` output. No vscode/IO so it is unit-tested in
// isolation. Flattens Jest's per-file assertion results into per-test outcomes the Testing API can
// consume: file + suite path → test, pass/fail/skip, duration, failure message, and source location.

export type JestStatus = "passed" | "failed" | "skipped";

export interface JestAssertion {
  /** Absolute path of the test file. */
  file: string;
  /** The test title (leaf `it`/`test`). */
  title: string;
  /** Enclosing `describe` titles, outermost first. */
  ancestorTitles: string[];
  status: JestStatus;
  /** Duration in milliseconds, when Jest recorded it. */
  durationMs?: number;
  /** Joined failure messages (present for failed tests). */
  message?: string;
  /** 1-based line of the test in `file` (needs `--testLocationInResults`). */
  line?: number;
  /** 0-based column, as Jest reports it. */
  column?: number;
}

// Jest statuses → our three states. pending/skipped/todo/disabled all read as skipped.
function mapStatus(raw: string | undefined): JestStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    default:
      return "skipped";
  }
}

/**
 * Parse `jest --json` stdout into flat assertion outcomes. Tolerant of missing fields; returns []
 * rather than throwing on malformed input. Jest prints the JSON on stdout even when tests fail, and
 * may prepend non-JSON lines — callers should pass the JSON object text (see extractJestJson).
 */
export function parseJestJson(json: string): JestAssertion[] {
  let doc: any;
  try {
    doc = JSON.parse(json);
  } catch {
    return [];
  }
  const out: JestAssertion[] = [];
  for (const file of Array.isArray(doc?.testResults) ? doc.testResults : []) {
    const filePath = file?.name ?? file?.testFilePath;
    for (const a of Array.isArray(file?.assertionResults) ? file.assertionResults : []) {
      if (!a?.title) {
        continue;
      }
      const messages: string[] = Array.isArray(a?.failureMessages) ? a.failureMessages : [];
      out.push({
        file: filePath ? String(filePath) : "",
        title: String(a.title),
        ancestorTitles: Array.isArray(a?.ancestorTitles) ? a.ancestorTitles.map(String) : [],
        status: mapStatus(a?.status),
        durationMs: typeof a?.duration === "number" ? a.duration : undefined,
        message: messages.length > 0 ? messages.join("\n\n") : undefined,
        line: typeof a?.location?.line === "number" ? a.location.line : undefined,
        column: typeof a?.location?.column === "number" ? a.location.column : undefined,
      });
    }
  }
  return out;
}

/**
 * Pull the JSON report out of Jest's stdout. The surrounding output can itself contain
 * braces — ts-jest's `globals` deprecation warning prints a `transform: { … }` config
 * snippet — so slicing first-{ to last-} corrupts the result (user report: passing runs
 * showed red in the Testing pane). Jest emits the report as ONE compact `{…}` line;
 * scan lines from the END for one that parses and carries testResults.
 */
export function extractJestJson(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        const doc = JSON.parse(line);
        if (doc && typeof doc === "object" && "testResults" in doc) {
          return line;
        }
      } catch {
        /* a braced line that isn't the report (e.g. logged JSON) — keep scanning */
      }
    }
  }
  return "";
}
