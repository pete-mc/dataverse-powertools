// Pure detection of [CrmPluginRegistration]-decorated plugin classes in C# source.
//
// The class-level "Profile & debug…" CodeLens was removed in #139 — profiling is now a per-STEP
// toggle CodeLens (decorationsCodeLens.ts) plus the plugin card's Active-profiles block, and the
// how-to guide moved to the plugin card's overflow menu (guidePluginProfiling). This module keeps
// only the pure class finder, which the toggle uses to resolve an attribute's enclosing type.

export interface PluginClassSite {
  /** Fully-qualified type name (namespace.Class). */
  typeName: string;
  /** 0-based line of the class declaration. */
  line: number;
}

/** Find [CrmPluginRegistration]-decorated classes in C# source. Pure. */
export function findPluginClasses(source: string): PluginClassSite[] {
  const sites: PluginClassSite[] = [];
  const lines = source.split(/\r?\n/);
  let namespaceName = "";
  let pendingAttribute = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const ns = line.match(/^\s*namespace\s+([A-Za-z0-9_.]+)/);
    if (ns) {
      namespaceName = ns[1];
    }
    if (/\[\s*CrmPluginRegistration/.test(line)) {
      pendingAttribute = true;
    }
    const cls = line.match(/^\s*(?:public\s+|internal\s+|sealed\s+|partial\s+)*class\s+([A-Za-z0-9_]+)/);
    if (cls) {
      if (pendingAttribute) {
        sites.push({ typeName: namespaceName ? `${namespaceName}.${cls[1]}` : cls[1], line: index });
      }
      pendingAttribute = false;
    }
  }
  return sites;
}
