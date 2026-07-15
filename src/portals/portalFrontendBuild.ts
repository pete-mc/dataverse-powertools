// Pure core for the Power Pages front-end build (#150, issue #1): compile a portal
// front-end TypeScript entry into a single browser web file (JS) with npm deps
// bundled, tree-shaking, and a source map — the OOTB stack has no real TS build.
// No `vscode` import → unit-tested; buildPortalFrontendCommand.ts runs esbuild.

/** esbuild CLI args to bundle a portal front-end entry into one browser web file. */
export function esbuildFrontendArgs(entryFile: string, outFile: string): string[] {
  return ["--bundle", entryFile, "--format=iife", "--target=es2017", "--minify", "--sourcemap", "--legal-comments=none", `--outfile=${outFile}`];
}

/** Output web-file name for a front-end entry (Power Pages JS web files are `.js`). */
export function frontendOutputName(entryFileName: string): string {
  return entryFileName.replace(/\.[cm]?tsx?$/i, "") + ".js";
}
