// PCF ControlManifest.Input.xml handling (#141). Two concerns, both kept here so
// the feature files don't each hand-roll them:
//   1. A PURE parser (parseControlManifest) — no `vscode`, no `fs` — that turns the
//      manifest XML into a small typed shape. Unit-tested. Backs the panel display,
//      the scaffold quick-pick's defaults, and any "which control is this" logic.
//   2. findControlDir — the fs walk that locates the directory holding the manifest,
//      previously copy-pasted in addServiceLayer.ts and runHarness.ts.
import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";
import { PcfTemplate, PcfFramework } from "./pcfArgs";

export const CONTROL_MANIFEST_FILENAME = "ControlManifest.Input.xml";

export interface ControlManifest {
  /** `<control namespace="…">` — the control's namespace. */
  namespace: string;
  /** `<control constructor="…">` — the control (class) name. */
  constructor: string;
  /** `<control version="…">`, if present. */
  version?: string;
  /** `<control display-name-key="…">`, if present (a resx key, not the display text). */
  displayNameKey?: string;
  /** field (a `<property>` control) vs dataset (a `<data-set>` grid control). */
  template: PcfTemplate;
  /** react when a `<platform-library name="React" …>` resource is declared, else none. */
  framework: PcfFramework;
}

/**
 * Parse a ControlManifest.Input.xml string into a typed shape (pure). Returns
 * undefined when the XML has no `<control>` element (not a manifest). The pac
 * template/framework are INFERRED from the manifest body — `<data-set>` ⇒ dataset,
 * a React platform-library ⇒ react — because the manifest itself is the source of
 * truth for a scaffolded control (the pac init flags aren't recorded anywhere else).
 */
export function parseControlManifest(xml: string): ControlManifest | undefined {
  if (!xml || !xml.includes("<control")) {
    return undefined;
  }
  let doc: unknown;
  try {
    doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", isArray: () => false }).parse(xml);
  } catch {
    return undefined;
  }
  const manifest = (doc as { manifest?: { control?: Record<string, unknown> } })?.manifest;
  const control = manifest?.control;
  if (!control || typeof control !== "object") {
    return undefined;
  }
  const attr = (name: string): string | undefined => {
    const v = (control as Record<string, unknown>)[`@_${name}`];
    return typeof v === "string" ? v : v === undefined ? undefined : String(v);
  };
  const namespace = attr("namespace");
  const ctor = attr("constructor");
  if (!namespace || !ctor) {
    return undefined;
  }
  const template: PcfTemplate = "data-set" in (control as Record<string, unknown>) ? "dataset" : "field";
  const framework: PcfFramework = hasReactPlatformLibrary(control as Record<string, unknown>) ? "react" : "none";
  return {
    namespace,
    constructor: ctor,
    version: attr("version"),
    displayNameKey: attr("display-name-key"),
    template,
    framework,
  };
}

/** True when the control declares a React platform-library resource (⇒ react framework). */
function hasReactPlatformLibrary(control: Record<string, unknown>): boolean {
  const resources = control["resources"];
  if (!resources || typeof resources !== "object") {
    return false;
  }
  const lib = (resources as Record<string, unknown>)["platform-library"];
  const libs = Array.isArray(lib) ? lib : lib ? [lib] : [];
  return libs.some((l) => {
    const name = l && typeof l === "object" ? (l as Record<string, unknown>)["@_name"] : undefined;
    return typeof name === "string" && name.toLowerCase() === "react";
  });
}

const IGNORED_DIRS = new Set(["node_modules", "out", "generated"]);

/**
 * Find the directory holding a control's ControlManifest.Input.xml under `root`
 * (depth-first, skipping node_modules/out/generated and dotfolders). Returns
 * undefined if none is found. Consolidated from addServiceLayer.ts / runHarness.ts.
 */
export function findControlDir(root: string): string | undefined {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  if (entries.some((e) => e.isFile() && e.name === CONTROL_MANIFEST_FILENAME)) {
    return root;
  }
  for (const e of entries) {
    if (e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith(".")) {
      const found = findControlDir(path.join(root, e.name));
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

/**
 * Find the PCF PROJECT ROOT under `root` — the directory holding the `.pcfproj` (and the
 * `package.json` with the pcf-scripts build + the `out/` build output). This is DISTINCT from
 * the control (manifest) directory: `pac pcf init` puts `ControlManifest.Input.xml` in a
 * `<Constructor>/` subfolder while `package.json`/`.pcfproj`/`out/` sit at the project root. So
 * the build/watch must run here, and the bundle lands at `<root>/out/controls/<Constructor>/…`.
 * Returns undefined if no `.pcfproj` is found.
 */
export function findPcfProjectRoot(root: string): string | undefined {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  if (entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith(".pcfproj"))) {
    return root;
  }
  for (const e of entries) {
    if (e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith(".")) {
      const found = findPcfProjectRoot(path.join(root, e.name));
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

/** Read + parse the manifest under a control directory, if present (impure convenience). */
export function readControlManifest(controlDir: string): ControlManifest | undefined {
  try {
    return parseControlManifest(fs.readFileSync(path.join(controlDir, CONTROL_MANIFEST_FILENAME), "utf8"));
  } catch {
    return undefined;
  }
}
