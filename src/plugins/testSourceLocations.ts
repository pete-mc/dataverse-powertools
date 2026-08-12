// Map discovered test names to their source location (#252).
//
// `dotnet test --list-tests` gives fully-qualified names and nothing else, so test items were created
// with no `uri`/`range`. VS Code needs those to tie a test to a file, and without them:
//   * "Test: Run/Debug Test at Cursor" cannot resolve a plug-in test,
//   * no run/debug icons appear in the gutter next to [Fact]/[TestMethod],
//   * clicking a test in the Testing side bar does not navigate to its source.
//
// The adapter does not report file/line for net462 xUnit/MSTest here, so locate them by scanning the
// test project's own sources. Deliberately a lightweight scan, not a C# parser: finding the class and
// then a method declaration by name covers how test classes are actually written, and a miss simply
// leaves the item unlocated (exactly today's behaviour) rather than pointing somewhere wrong.
//
// Pure (no `vscode`, no fs) → unit-tested. The caller supplies file contents.

export interface TestLocation {
  /** 0-based line, ready for a vscode.Range. */
  line: number;
}

/** Strip `//` and `/* *​/` comments so a commented-out copy of a test can't win the match. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, (line) => line.replace(/./g, " "));
}

/** The bare class name from a fully-qualified name (`Ns.Sub.Class` -> `Class`). */
export function bareName(qualified: string): string {
  const parts = (qualified ?? "").split(".");
  return parts[parts.length - 1] ?? "";
}

/**
 * Line of a class declaration, or undefined. Matches `class Foo` with optional modifiers/partial and an
 * optional base list, so it does not confuse `FooTests` with `Foo`.
 */
export function findClassLine(source: string, className: string): number | undefined {
  const bare = bareName(className);
  if (!bare) {
    return undefined;
  }
  const pattern = new RegExp(`\\bclass\\s+${bare.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`);
  const lines = withoutComments(source).split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  return index === -1 ? undefined : index;
}

/**
 * Line of a method declaration named `methodName`, searched from `fromLine` so the match belongs to the
 * right class in a file holding several. Undefined when not found.
 */
export function findMethodLine(source: string, methodName: string, fromLine = 0): number | undefined {
  if (!methodName) {
    return undefined;
  }
  // `Name(` preceded by a return type / modifier — enough to skip a call like `Foo(); // Name(`.
  const pattern = new RegExp(`\\b(?:void|Task|async|public|private|internal|protected|static)\\b[^;=]*\\b${methodName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\(`);
  const lines = withoutComments(source).split(/\r?\n/);
  for (let index = Math.max(0, fromLine); index < lines.length; index++) {
    if (pattern.test(lines[index])) {
      return index;
    }
  }
  return undefined;
}

/**
 * Locate a test's class and (optionally) its method within one file's text.
 *
 * Returns undefined when the class is not in this file, so the caller can try the next one.
 */
export function locateTest(source: string, className: string, methodName?: string): TestLocation | undefined {
  const classLine = findClassLine(source, className);
  if (classLine === undefined) {
    return undefined;
  }
  if (!methodName) {
    return { line: classLine };
  }
  const methodLine = findMethodLine(source, methodName, classLine);
  // A class we found but a method we did not still locates usefully — the file is right.
  return { line: methodLine ?? classLine };
}
