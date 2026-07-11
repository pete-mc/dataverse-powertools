// Pure parser for `dotnet test --list-tests` output. No vscode/IO so it is unit-tested in isolation.
// Turns the flat "The following Tests are available:" list into class → method pairs for the tree.

export interface DiscoveredTest {
  /** Fully-qualified name as dotnet reports it (data-row suffix stripped). */
  fqn: string;
  /** Class part (everything before the final dot). */
  className: string;
  /** Method part (after the final dot). */
  methodName: string;
}

/**
 * Parse `dotnet test --list-tests` stdout into discovered tests. Everything before the
 * "available:" banner is tooling noise and ignored; each remaining non-empty line is one
 * fully-qualified test name. Data-driven suffixes (`Test(1,2)`) are trimmed to the method.
 */
export function parseDotnetListTests(stdout: string): DiscoveredTest[] {
  const lines = stdout.split(/\r?\n/);
  const bannerIndex = lines.findIndex((l) => /following Tests are available/i.test(l));
  const testLines = bannerIndex === -1 ? [] : lines.slice(bannerIndex + 1);

  const seen = new Set<string>();
  const tests: DiscoveredTest[] = [];
  for (const raw of testLines) {
    const line = raw.trim();
    // Stop at the trailing tooling summary lines (they aren't indented test names).
    if (!line || /^(Microsoft|Copyright|Test run|Passed|Failed|Total|Warning|error)/i.test(line)) {
      continue;
    }
    // Drop a data-driven argument list: "Ns.Class.Method(1, "a")" → "Ns.Class.Method".
    const fqn = line.replace(/\(.*\)\s*$/, "").trim();
    const lastDot = fqn.lastIndexOf(".");
    if (lastDot <= 0 || seen.has(fqn)) {
      continue;
    }
    seen.add(fqn);
    tests.push({ fqn, className: fqn.slice(0, lastDot), methodName: fqn.slice(lastDot + 1) });
  }
  return tests;
}
