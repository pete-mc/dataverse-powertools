// The `dotnet test` command line for a Test Explorer run, and the decision of what a TRX outcome
// means for the run. Pure so both can be tested without an extension host — the controller around
// them is all `vscode.TestController` API.
//
// The filter is the part worth pinning. VSTest's `--filter` uses `|` for OR; joining with anything
// else silently runs the wrong set, and an EMPTY filter string is not "no tests" but "every test" —
// so a selection that resolves to nothing must omit the flag and be skipped by the caller, never
// passed through as `--filter ""`.

/** A run targeting specific tests, or every test when `fqns` is undefined. */
export interface TestSelection {
  /** Fully-qualified names of the selected leaf tests; undefined means "run everything". */
  fqns?: readonly string[];
}

/** The `--filter` args for a selection — empty for a whole-suite run. */
export function buildTestFilterArgs(selection: TestSelection): string[] {
  if (!selection.fqns) {
    return [];
  }
  const named = selection.fqns.filter((fqn) => fqn.trim().length > 0);
  if (named.length === 0) {
    return [];
  }
  return ["--filter", named.map((fqn) => `FullyQualifiedName=${fqn}`).join("|")];
}

/**
 * Whether the run should proceed at all. A selection that resolved to no test names must NOT run:
 * with no `--filter`, `dotnet test` runs the entire suite, so "run this one test" would silently
 * become "run everything".
 */
export function shouldRunSelection(selection: TestSelection): boolean {
  return !selection.fqns || selection.fqns.some((fqn) => fqn.trim().length > 0);
}

export interface DotnetTestArgsOptions {
  testProject: string;
  trxName: string;
  resultsDirectory: string;
  selection: TestSelection;
}

/** `dotnet test <project> --logger trx;… --results-directory <dir> [--filter …]` */
export function buildDotnetTestArgs(options: DotnetTestArgsOptions): string[] {
  return [
    "test",
    options.testProject,
    "--logger",
    `trx;LogFileName=${options.trxName}`,
    "--results-directory",
    options.resultsDirectory,
    ...buildTestFilterArgs(options.selection),
  ];
}

/** What a TRX outcome means to the Test Explorer. Anything unrecognised counts as a failure — a
 * result we can't interpret is not evidence the test passed. */
export function testRunStateFor(outcome: string | undefined): "passed" | "skipped" | "failed" {
  if (outcome === "passed") {
    return "passed";
  }
  return outcome === "skipped" ? "skipped" : "failed";
}
