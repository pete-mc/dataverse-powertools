// Pure core for the Power Pages Server Logic build (#150, issue #2 — the enabling
// feature). Server Logic has NO module system at runtime (import/require are
// blocked), so sharing code across logics is impossible OOTB. The fix: bundle each
// logic's TS (with its shared imports inlined) into ONE self-contained ES2023
// script exposing top-level get()/post()/… — no ESM/CJS wrapper, no import in the
// output. esbuild does the inlining; `stripModuleSyntax` removes the ESM export
// bookkeeping esbuild emits so the result is a classic script. No `vscode` import.

/** esbuild CLI args to bundle a Server Logic entry into a single ES2023 file. */
export function esbuildServerLogicArgs(entryFile: string, outFile: string): string[] {
  return ["--bundle", entryFile, "--format=esm", "--target=es2023", "--platform=neutral", "--legal-comments=none", `--outfile=${outFile}`];
}

/**
 * Turn esbuild's bundled ESM output into a classic Server Logic script: drop the
 * `export { … }` bookkeeping statements, `export default`, and leading `export `
 * on top-level declarations, leaving top-level `function get()/post()/…`. The
 * bundle already has no `import` (everything is inlined), so the result contains
 * no module syntax at all.
 */
export function stripModuleSyntax(bundledCode: string): string {
  return (
    bundledCode
      // `export { get, post as handler };` bookkeeping (with or without renames)
      .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, "")
      // `export default …` → keep the value as a statement is meaningless for
      // Server Logic; drop the keyword so it's a no-op expression at worst.
      .replace(/^\s*export\s+default\s+/gm, "")
      // `export function get(){}` / `export const x =` → strip the leading keyword
      .replace(/^(\s*)export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm, "$1")
      // collapse the blank lines left behind
      .replace(/\n{3,}/g, "\n\n")
      .trimStart()
  );
}

/** Output file name for a built Server Logic (from its entry file name). */
export function serverLogicOutputName(entryFileName: string): string {
  return entryFileName.replace(/\.[cm]?tsx?$/i, "") + ".serverlogic.js";
}
