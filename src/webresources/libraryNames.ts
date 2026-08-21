// Which deployed JS web resource a source file's form events register against.
//
// Derived from settings (prefix + output mode, #88) — NOT scraped from
// webpack.common.js: the old regex scrape expected `output: { filename: "…" }`
// and silently returned undefined once the template gained the per-file
// ternary, which serialized a <Library> element WITHOUT its required `name`
// attribute and had Dataverse reject the whole form (0x80048425).

/** The bundle base name used when a project doesn't configure one — i.e. every project
 * scaffolded before #258, and every root component since. Changing this would rename the
 * deployed web resource of every existing project, orphaning it and breaking the form
 * registrations that point at it. Don't. */
export const DEFAULT_LIBRARY_BASE = "library";

/** Only what a Dataverse web-resource name segment safely allows. */
function sanitiseLibraryBase(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "");
}

/**
 * The bundle base name a NEWLY scaffolded component should be given (#258).
 *
 * Bundle mode deploys to `{prefix}_{base}.js`, and `deployWebresources` uploads everything in
 * `bin/` BY FILENAME — so before this, two web-resource components in one workspace (#47) both
 * produced `{prefix}_library.js` and the second silently deployed over the first.
 *
 * The root component keeps `library`, so single-component projects — which is nearly all of them
 * — are completely unaffected. A sub-component is named after its folder, which is unique within
 * the workspace by construction. Only ever called at scaffold time: applying it to an EXISTING
 * component would rename a resource that is already deployed.
 */
export function defaultLibraryBaseName(relativeRoot: string): string {
  const leaf = relativeRoot.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  const sanitised = sanitiseLibraryBase(leaf);
  return sanitised || DEFAULT_LIBRARY_BASE;
}

/** Whether `value` is usable as a bundle base name — i.e. survives sanitising unchanged.
 * Used by the scaffold prompt's `validateInput` so a name is rejected while it is being typed
 * rather than silently sanitised into something else at build time. */
export function isValidLibraryBase(value: string): boolean {
  return value.length > 0 && sanitiseLibraryBase(value) === value;
}

/** The configured bundle base for a component, falling back to the historical `library`. */
export function libraryBaseFor(settings: { webresourceLibraryName?: string } | undefined): string {
  const configured = sanitiseLibraryBase(settings?.webresourceLibraryName ?? "");
  return configured || DEFAULT_LIBRARY_BASE;
}

export function webresourceLibraryName(prefix: string, output: "bundle" | "perFile" | undefined, sourceFilePath: string, bundleBase: string = DEFAULT_LIBRARY_BASE): string {
  if (output === "perFile") {
    const base = sourceFilePath.replace(/\\/g, "/").split("/").pop()!.replace(/\.ts$/, "");
    // library.ts isn't a per-file entry — it (and bundle mode) maps to the bundled name.
    if (base !== "library") {
      return `${prefix}_${base}.js`;
    }
  }
  return `${prefix}_${sanitiseLibraryBase(bundleBase) || DEFAULT_LIBRARY_BASE}.js`;
}

/** Every library name this project could have produced in EITHER output mode.
 * The registration cleanup may only delete handlers whose library is in this
 * set — never another solution's — and covering both modes means leftovers
 * from a mode switch are cleaned up too. */
export function candidateLibraryNames(prefix: string, sourceFilePaths: string[], bundleBase: string = DEFAULT_LIBRARY_BASE): Set<string> {
  // Both the CONFIGURED bundle name and the historical `library`: a project that renames its
  // bundle still has handlers pointing at the old name, and those are ours to clean up. Missing
  // the old name would strand them on a web resource that no longer gets deployed.
  const names = new Set([`${prefix}_${sanitiseLibraryBase(bundleBase) || DEFAULT_LIBRARY_BASE}.js`, `${prefix}_${DEFAULT_LIBRARY_BASE}.js`]);
  for (const file of sourceFilePaths) {
    names.add(webresourceLibraryName(prefix, "perFile", file));
  }
  return names;
}
