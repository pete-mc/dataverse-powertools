import { describe, it, expect } from "vitest";
import { isWebresourceBundleUrl, bundleCdpPattern, bundleContentType } from "./webresourceUrlMatch";

const bundle = "dvpt_library.js";
const org = "https://org.crm.dynamics.com";

describe("isWebresourceBundleUrl", () => {
  it("matches the plain /WebResources/<name> path", () => {
    expect(isWebresourceBundleUrl(`${org}/WebResources/dvpt_library.js`, bundle)).toBe(true);
  });

  it("matches a cache-busting version-brace segment (percent-encoded, lowercase path)", () => {
    expect(isWebresourceBundleUrl(`${org}/%7B638500000000000000%7D/webresources/dvpt_library.js`, bundle)).toBe(true);
  });

  it("matches regardless of case and with a ?ver query", () => {
    expect(isWebresourceBundleUrl(`${org}/WEBRESOURCES/DVPT_LIBRARY.JS?ver=1699999999`, bundle)).toBe(true);
  });

  it("does not match the source map for the same bundle", () => {
    expect(isWebresourceBundleUrl(`${org}/WebResources/dvpt_library.js.map`, bundle)).toBe(false);
  });

  it("does not match a different web resource", () => {
    expect(isWebresourceBundleUrl(`${org}/WebResources/other_library.js`, bundle)).toBe(false);
  });

  it("does not match a same-named file outside /webresources/", () => {
    expect(isWebresourceBundleUrl(`${org}/scripts/dvpt_library.js`, bundle)).toBe(false);
  });

  it("returns false for an empty bundle name", () => {
    expect(isWebresourceBundleUrl(`${org}/WebResources/dvpt_library.js`, "")).toBe(false);
  });
});

describe("bundleCdpPattern", () => {
  it("wraps the bundle name in wildcards", () => {
    expect(bundleCdpPattern(bundle)).toBe("*/dvpt_library.js*");
  });
});

describe("bundleContentType", () => {
  it("defaults to application/javascript", () => {
    expect(bundleContentType("dvpt_library.js")).toBe("application/javascript");
  });
  it("maps css and html", () => {
    expect(bundleContentType("styles.css")).toBe("text/css");
    expect(bundleContentType("page.html")).toBe("text/html");
  });
});
