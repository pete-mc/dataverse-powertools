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
export function candidateLibraryNames(prefix: string, sourceFilePaths: string[], bundleBase: string = DEFAULT_LIBRARY_BASE, previousBases: string[] = []): Set<string> {
  // The CONFIGURED bundle name, the historical `library`, and any name this component previously
  // deployed under: a renamed bundle still has handlers pointing at the old name, and those are
  // ours to clean up. Missing one strands its handlers on a web resource nobody deploys.
  const names = new Set([
    `${prefix}_${sanitiseLibraryBase(bundleBase) || DEFAULT_LIBRARY_BASE}.js`,
    `${prefix}_${DEFAULT_LIBRARY_BASE}.js`,
    ...previousBases.map((base) => `${prefix}_${sanitiseLibraryBase(base) || DEFAULT_LIBRARY_BASE}.js`),
  ]);
  for (const file of sourceFilePaths) {
    names.add(webresourceLibraryName(prefix, "perFile", file));
  }
  return names;
}

/**
 * The part of a source path below `webresources_src` — `Account.ts`, `sub/Thing.ts`.
 *
 * Falls back to the bare filename when there is no `webresources_src` segment, so a path we can't
 * place is treated as top-level (i.e. buildable). The callers use this to decide what to SKIP, and
 * skipping a registration we merely failed to classify would be worse than processing it.
 */
export function pathBelowSourceRoot(sourceFilePath: string): string {
  const normalised = sourceFilePath.replace(/\\/g, "/");
  const marker = "/webresources_src/";
  const index = normalised.lastIndexOf(marker);
  return index === -1 ? (normalised.split("/").pop() ?? "") : normalised.slice(index + marker.length);
}

/**
 * Whether per-file output mode actually BUILDS this source file.
 *
 * Mirrors the filter in templates/webresources/webpack.common.js exactly: per-file entries are the
 * TOP-LEVEL `webresources_src/*.ts`, excluding `.d.ts` and the `library.ts` barrel. A file that
 * isn't an entry produces no output, so a form registration inside one would bind a handler to a
 * web resource that is never deployed — the `<Library>` names something that isn't there.
 *
 * `relativeToSourceRoot` is the path BELOW `webresources_src`, e.g. `Account.ts` or `sub/Thing.ts`.
 */
export function isPerFileEntry(relativeToSourceRoot: string): boolean {
  const normalised = relativeToSourceRoot.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalised.includes("/")) {
    return false; // nested — perFileEntries() only reads the top level
  }
  if (!normalised.endsWith(".ts") || normalised.endsWith(".d.ts")) {
    return false;
  }
  return normalised !== "library.ts";
}

/**
 * Every web resource a component would DEPLOY, in whichever mode it is in.
 *
 * `deployWebresources` upserts each file in `bin/` by name, so this is the component's claim on
 * the shared namespace — bundle mode claims one name, per-file mode claims one per buildable
 * source file. Used to find collisions between components (#258); two components claiming the
 * same name means whichever deploys second silently replaces the first.
 */
export function deployedWebresourceNames(
  prefix: string,
  settings: { webresourceLibraryName?: string; webresourceOutput?: "bundle" | "perFile" } | undefined,
  sourceFilesRelativeToSourceRoot: string[],
): string[] {
  if (settings?.webresourceOutput !== "perFile") {
    return [webresourceLibraryName(prefix, "bundle", "library.ts", libraryBaseFor(settings))];
  }
  const names = sourceFilesRelativeToSourceRoot.filter(isPerFileEntry).map((f) => webresourceLibraryName(prefix, "perFile", f));
  return [...new Set(names)];
}

/** A component's claim on the deployed-name namespace. */
export interface WebresourceClaim {
  /** Component path relative to the workspace root; "" for the root component. */
  relativeRoot: string;
  /** What that component would deploy — from `deployedWebresourceNames`. */
  names: string[];
}

/**
 * Deployed names claimed by more than one component (#258).
 *
 * Covers BOTH modes deliberately. It would be easy to assume only bundle-mode components can
 * collide, since per-file names come from source filenames — but two per-file components that
 * both contain `Account.ts` both deploy `{prefix}_Account.js`, which is the same silent overwrite.
 * Returns one entry per contested name, listing every component claiming it; empty when clean.
 */
export function findWebresourceNameCollisions(claims: WebresourceClaim[]): Array<{ name: string; components: string[] }> {
  const byName = new Map<string, string[]>();
  for (const claim of claims) {
    for (const name of new Set(claim.names)) {
      byName.set(name, [...(byName.get(name) ?? []), claim.relativeRoot]);
    }
  }
  return [...byName.entries()]
    .filter(([, components]) => components.length > 1)
    .map(([name, components]) => ({ name, components }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A bundle base name not already claimed — `base`, else `base2`, `base3`… */
export function freeLibraryBase(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  const start = sanitiseLibraryBase(base) || DEFAULT_LIBRARY_BASE;
  if (!used.has(start.toLowerCase())) {
    return start;
  }
  for (let n = 2; ; n++) {
    const candidate = `${start}${n}`;
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}
