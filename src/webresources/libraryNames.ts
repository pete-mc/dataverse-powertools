// Which deployed JS web resource a source file's form events register against.
//
// Derived from settings (prefix + output mode, #88) — NOT scraped from
// webpack.common.js: the old regex scrape expected `output: { filename: "…" }`
// and silently returned undefined once the template gained the per-file
// ternary, which serialized a <Library> element WITHOUT its required `name`
// attribute and had Dataverse reject the whole form (0x80048425).

export function webresourceLibraryName(prefix: string, output: "bundle" | "perFile" | undefined, sourceFilePath: string): string {
  if (output === "perFile") {
    const base = sourceFilePath.replace(/\\/g, "/").split("/").pop()!.replace(/\.ts$/, "");
    // library.ts isn't a per-file entry — it (and bundle mode) maps to the bundled name.
    if (base !== "library") {
      return `${prefix}_${base}.js`;
    }
  }
  return `${prefix}_library.js`;
}

/** Every library name this project could have produced in EITHER output mode.
 * The registration cleanup may only delete handlers whose library is in this
 * set — never another solution's — and covering both modes means leftovers
 * from a mode switch are cleaned up too. */
export function candidateLibraryNames(prefix: string, sourceFilePaths: string[]): Set<string> {
  const names = new Set([`${prefix}_library.js`]);
  for (const file of sourceFilePaths) {
    names.add(webresourceLibraryName(prefix, "perFile", file));
  }
  return names;
}
