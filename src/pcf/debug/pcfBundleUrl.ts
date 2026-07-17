// Pure helpers for the PCF live-form hot-reload (#141 #5): match the browser's request for a
// DEPLOYED code component's bundle and resolve the local build to fulfil it with. This is the
// CDP-interception analogue of the official Fiddler/Requestly "AutoResponder" debug flow
// (learn.microsoft.com/power-apps/developer/component-framework/debugging-custom-controls):
// a deployed control's bundle is served at a URL containing "<Namespace>.<Constructor>" then the
// resource file (bundle.js), and the local build lands in "out/controls/<Constructor>/bundle.js".
// Keying on "<Namespace>.<Constructor>" + the filename (NOT a "/webresources/" segment) matches
// the platform's URL across its version/casing/encoding variants, mirroring the docs' regex.
import * as path from "path";

export const PCF_BUNDLE_FILENAME = "bundle.js";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(decodeURIComponent(value)); // platform sometimes double-encodes the "/" in css/html subpaths
  } catch {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
}

/** The "<namespace>.<constructor>" control key, lower-cased (how it appears in the served URL). */
export function controlKey(namespace: string, constructorName: string): string {
  return `${namespace}.${constructorName}`.toLowerCase();
}

/**
 * True when `url` is the deployed control's bundle.js request. Matches when the decoded URL
 * contains "<namespace>.<constructor>" followed (after a "/" or ".") by the bundle filename —
 * the shape the platform serves a code component's bundle at, across its URL variants.
 */
export function isPcfBundleUrl(url: string, namespace: string, constructorName: string): boolean {
  if (!url || !namespace || !constructorName) {
    return false;
  }
  const decoded = safeDecode(url).toLowerCase();
  const key = controlKey(namespace, constructorName);
  const idx = decoded.indexOf(key);
  if (idx === -1) {
    return false;
  }
  // After the control key, the next path/query segment must be the bundle filename (allow a
  // "/" or "." separator, e.g. ".../SampleNs.Control/bundle.js" or a versioned ".../...bundle.js").
  const rest = decoded.slice(idx + key.length);
  return new RegExp(`[./]${PCF_BUNDLE_FILENAME.replace(".", "\\.")}(\\?|$)`).test(rest);
}

/** A broad CDP `Fetch.enable` urlPattern that pauses candidate bundle requests (the precise
 * decision is `isPcfBundleUrl`). Over-matches on the filename so no path variant is missed. */
export function pcfBundleCdpPattern(): string {
  return `*${PCF_BUNDLE_FILENAME}*`;
}

/** Local build output for a control's bundle: "<controlDir>/out/controls/<Constructor>/bundle.js"
 * (the pcf-scripts build output; NOT the test-harness output). Pure — path only. */
export function pcfLocalBundlePath(controlDir: string, constructorName: string): string {
  return path.join(controlDir, "out", "controls", constructorName, PCF_BUNDLE_FILENAME);
}

/** Content type to serve the fulfilled bundle with. */
export function pcfBundleContentType(): string {
  return "application/javascript";
}
