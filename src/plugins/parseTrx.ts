import { XMLParser } from "fast-xml-parser";

// Pure parser for VSTest TRX result files (`dotnet test --logger "trx;..."`). No vscode/IO so it is
// unit-tested in isolation. Maps a TRX into flat per-test outcomes the Testing API can consume:
// suite (class) → test, pass/fail/skip, duration, and the failure message + stack for a TestMessage.

export type TrxOutcome = "passed" | "failed" | "skipped";

export interface TrxTestResult {
  /** Raw `@_testName` — in practice VSTest writes the fully-qualified name here. */
  testName: string;
  /** Fully-qualified class name — the suite the test hangs under, when the TRX records it. */
  className?: string;
  /** Best-effort fully-qualified name (`Class.Method`) for matching against discovered items. */
  fqn: string;
  outcome: TrxOutcome;
  /** Wall-clock duration in milliseconds, when recorded. */
  durationMs?: number;
  /** Failure message (present for failed tests). */
  message?: string;
  /** Failure stack trace (present for failed tests). */
  stackTrace?: string;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

// TRX outcome strings → our three states. Anything not Passed/Failed (NotExecuted, Inconclusive,
// Timeout treated as failed below, etc.) that means "did not pass and wasn't a real failure" is skipped.
function mapOutcome(raw: string | undefined): TrxOutcome {
  switch ((raw ?? "").toLowerCase()) {
    case "passed":
      return "passed";
    case "failed":
    case "timeout":
    case "aborted":
      return "failed";
    default:
      return "skipped";
  }
}

/**
 * Parse a TRX duration ("HH:MM:SS.fffffff") into milliseconds. Returns undefined for missing/invalid.
 */
export function parseTrxDuration(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const match = raw.match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/);
  if (!match) {
    return undefined;
  }
  const [, h, m, s, frac] = match;
  const fractionMs = frac ? Number(`0.${frac}`) * 1000 : 0;
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + fractionMs;
}

/**
 * Parse the XML of a VSTest TRX file into flat test outcomes. Tolerant of missing sections and of
 * single-vs-array element shapes; returns [] rather than throwing on malformed input.
 */
export function parseTrx(xml: string): TrxTestResult[] {
  let doc: any;
  try {
    doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
  } catch {
    return [];
  }
  const testRun = doc?.TestRun;
  if (!testRun) {
    return [];
  }

  // testId -> fully-qualified class name, from <TestDefinitions><UnitTest><TestMethod className.../>.
  const classById = new Map<string, string>();
  for (const unitTest of asArray(testRun?.TestDefinitions?.UnitTest)) {
    const id = unitTest?.["@_id"];
    const className = unitTest?.TestMethod?.["@_className"];
    if (id && className) {
      // The className is often "Namespace.Class, Assembly" — keep just the type name.
      classById.set(String(id), String(className).split(",")[0].trim());
    }
  }

  const results: TrxTestResult[] = [];
  for (const result of asArray(testRun?.Results?.UnitTestResult)) {
    const testName = result?.["@_testName"];
    if (!testName) {
      continue;
    }
    const errorInfo = result?.Output?.ErrorInfo;
    const rawName = String(testName);
    const className = classById.get(String(result?.["@_testId"]));
    // VSTest usually writes the FQN into testName; if not (or no class known) build it from the class.
    const fqn = className && !rawName.startsWith(`${className}.`) ? `${className}.${rawName}` : rawName;
    results.push({
      testName: rawName,
      className,
      fqn,
      outcome: mapOutcome(result?.["@_outcome"]),
      durationMs: parseTrxDuration(result?.["@_duration"]),
      message: errorInfo?.Message !== undefined ? String(errorInfo.Message) : undefined,
      stackTrace: errorInfo?.StackTrace !== undefined ? String(errorInfo.StackTrace) : undefined,
    });
  }
  return results;
}
