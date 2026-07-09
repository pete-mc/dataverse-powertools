// Pure helpers for matching the browser's request for a web-resource bundle and for
// building the response we fulfil it with. Dataverse serves web resources under a
// "/WebResources/<name>" path, often with a cache-busting version segment
// ("/%7B<version>%7D/webresources/<name>"), varying case, and/or a "?ver=" query — so
// matching keys on the "/webresources/<name>" tail rather than an exact URL.

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    // Not an absolute URL — strip any query/hash and use as-is.
    return url.split(/[?#]/)[0];
  }
}

const WEBRESOURCES_SEGMENT = "/webresources/";

/**
 * True when `url` is the Dataverse request for the web-resource named `bundleName`,
 * across the path/casing/version variants the platform uses. Keys on the final
 * "/webresources/<name>" segment so a source-map or differently-named resource is not
 * matched.
 */
export function isWebresourceBundleUrl(url: string, bundleName: string): boolean {
  if (!bundleName) {
    return false;
  }
  const decodedPath = safeDecode(pathnameOf(url)).toLowerCase();
  const name = bundleName.toLowerCase();
  const idx = decodedPath.lastIndexOf(WEBRESOURCES_SEGMENT);
  if (idx === -1) {
    return false;
  }
  const tail = decodedPath.slice(idx + WEBRESOURCES_SEGMENT.length);
  return tail === name;
}

/**
 * A broad CDP `Fetch.enable` urlPattern that pauses candidate requests for this bundle.
 * It over-matches on purpose (the precise decision is `isWebresourceBundleUrl`) so we
 * don't intercept unrelated traffic while still catching every path variant.
 */
export function bundleCdpPattern(bundleName: string): string {
  return `*/${bundleName}*`;
}

/** Content type to serve a locally-fulfilled web-resource bundle with. */
export function bundleContentType(bundleName: string): string {
  const lower = bundleName.toLowerCase();
  if (lower.endsWith(".css")) {
    return "text/css";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "text/html";
  }
  return "application/javascript";
}
