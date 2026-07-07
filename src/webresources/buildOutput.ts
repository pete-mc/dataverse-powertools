// Pure helpers for interpreting webpack build output. No `vscode` import — keep
// it unit-testable. (The previous inline version used a regex that matched a
// literal backslash, not the ANSI escape, so colour codes were never stripped.)

// Matches ANSI SGR colour codes: ESC [ ... m. Built via `new RegExp` so the ESC
// character is written as an unambiguous escape rather than a literal control byte.
const ANSI_PATTERN = new RegExp("\\u001b\\[[0-9;]*m", "g");

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/**
 * webpack prints "ERROR in <module>" for compilation errors. Treat that marker as
 * a build failure (in addition to a non-zero process exit code). This is narrower
 * than the old `output.includes("ERROR")`, which also fired on paths/words
 * containing "ERROR" and on the "0 ERRORS" summary line.
 */
export function buildOutputHasErrors(output: string): boolean {
  return /ERROR in /.test(stripAnsi(output));
}
