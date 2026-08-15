// Post-run sanity audit of the extension's full e2e output log.
//
// The suites gate steps on KNOWN log lines (expectOutput + failMarkers), but a
// failure they didn't predict — a 400 form save, a 429 publish, an unexpected
// exception — can scroll past while every coded gate still passes (that's how
// the 0x80048425 library-name regression survived a "23 passing" run). During
// e2e the extension mirrors every output-channel line to a file
// (DVPT_TEST_LOG_FILE); after ExTester finishes, the launcher runs this audit
// over the WHOLE log. Pure so it's unit-tested; the launcher requires the
// compiled build.

export interface LogFinding {
  line: number;
  text: string;
  pattern: string;
}

/** Failure signatures worth flagging even when no coded gate caught them. */
const SUSPICIOUS: { name: string; pattern: RegExp }[] = [
  { name: "failure", pattern: /\bfailed\b|\bfailure\b/i },
  { name: "error", pattern: /\berror\b/i },
  { name: "exception", pattern: /exception/i },
  { name: "dataverse-hresult", pattern: /0x8[0-9a-f]{7}/i },
  { name: "http-error", pattern: /\b(400|401|403|404|409|429|500|502|503) [A-Z]|"code":\s*"0x/i },
  { name: "node-network", pattern: /\b(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EINVAL|ENOENT)\b/ },
  { name: "schema", pattern: /does not conform|schema validation/i },
  { name: "auth", pattern: /unauthorized|forbidden|token.*expired/i },
  // \b guards: "hang" is inside "Unchanged", which the sync summaries print.
  { name: "stuck", pattern: /timed? ?out|\bhangs?\b|\bhanging\b|\bstuck\b/i },
  { name: "cannot", pattern: /\bcannot\b|\bunable to\b|not recognized/i },
];

/** Lines that legitimately contain a suspicious word — expected, handled, or
 * tool chatter. Extend this list when the audit flags something benign. */
const BENIGN: RegExp[] = [
  /\b0 errors?\b/i, // webpack/tsc summaries: "compiled with 0 errors"
  /\b0 Error\(s\)/, // dotnet build summary
  /\b0 Warning\(s\)/,
  /compiled successfully/i,
  /A publish is already running — retrying/, // handled busy-retry (the retry SUCCEEDING is the pass signal)
  /error loading|onerror/i, // generic JS identifiers in served bundle chatter
  /Errors?: 0\b/i, // jest/dotnet counters
  /\[Deprecated\]/, // legacy-template notices
  /hierarchyLevel|errorhandler/i, // metadata/typings identifiers containing "error"
  /Failed=0\b/i, // trx-style counters
  /passExecutionContext/i, // form XML attribute containing "ExecutionContext"
  /\(in \d+\s*ms\)/i, // build/restore timing "Restored … (in 401 ms)" — the http-error rule's /i makes [A-Z] match the "ms", not an HTTP 401
  // The profiler suite's debug step ENDS the replay's debug session on purpose (it cannot drive
  // Continue — see pluginProfilerReplay.e2e.ts), which kills the waiting test host and makes VSTest say
  // so. Narrow on purpose: only the testhost-exited line, and only with the empty reason a kill
  // produces — a real crash carries a reason, and `Build failed`-style signatures stay unmasked (#249).
  /^Testhost process for source\(s\) '.*' exited with error: \. Please check the diagnostic logs/,
  // Clearing the TEMPORARY assembly content after a profiling capture can 400 (0x80040216) — the
  // capture itself has already succeeded and been saved, and the extension says so on the very next
  // line ("it self-heals on the next Build & deploy"). Narrow on purpose: the specific message and code,
  // so a 400 from any other operation is still reported (#249's rule — never mask a signature a real
  // regression would produce).
  /^Failed to set the plugin assembly content: 400 Bad Request — .*0x80040216/,
];

/** Audit a full e2e log. Returns findings for suspicious lines not covered by
 * the benign allowlist, deduplicated by text (a retried line reports once). */
export function auditLog(logText: string): LogFinding[] {
  const findings: LogFinding[] = [];
  const seen = new Set<string>();
  const lines = logText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim();
    if (!text || BENIGN.some((benign) => benign.test(text))) {
      continue;
    }
    const match = SUSPICIOUS.find((rule) => rule.pattern.test(text));
    if (!match || seen.has(text)) {
      continue;
    }
    seen.add(text);
    findings.push({ line: index + 1, text, pattern: match.name });
  }
  return findings;
}

/** Human-readable report for the launcher to print. */
export function formatAuditReport(findings: LogFinding[], scannedLines: number): string {
  if (findings.length === 0) {
    return `[e2e] log audit: ${scannedLines} lines scanned, no unexplained failure signatures.`;
  }
  const rows = findings.map((f) => `  line ${f.line} [${f.pattern}] ${f.text}`);
  return [`[e2e] log audit: ${findings.length} unexplained failure signature(s) in ${scannedLines} lines — investigate or extend the benign allowlist:`, ...rows].join("\n");
}
