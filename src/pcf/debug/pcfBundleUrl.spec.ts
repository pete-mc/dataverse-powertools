import { describe, it, expect } from "vitest";
import { isPcfBundleUrl, pcfBundleCdpPattern, pcfLocalBundlePath, pcfBundleContentType, controlKey, PCF_BUNDLE_FILENAME } from "./pcfBundleUrl";

// Ground truth: the platform serves a deployed code component's bundle at a URL containing
// "<Namespace>.<Constructor>" then the resource file (bundle.js) — the same shape the official
// Fiddler/Requestly AutoResponder debug flow matches. Local build → out/controls/<Constructor>/bundle.js.
const NS = "SampleNamespace";
const CTOR = "ChoicesPicker";

describe("isPcfBundleUrl (#141 live-form hot reload)", () => {
  it("matches the deployed control bundle URL across platform variants", () => {
    const urls = [
      "https://org.crm.dynamics.com/webresources/SampleNamespace.ChoicesPicker/bundle.js",
      "https://org.crm.dynamics.com/%7b637123456789%7d/webresources/SampleNamespace.ChoicesPicker/bundle.js",
      "https://org.crm.dynamics.com/WebResources/SampleNamespace.ChoicesPicker/bundle.js?ver=1.0.0",
      "https://org.crm.dynamics.com/uclient/.../SampleNamespace.ChoicesPicker.bundle.js", // dotted variant
    ];
    for (const url of urls) {
      expect(isPcfBundleUrl(url, NS, CTOR), url).toBe(true);
    }
  });

  it("is case-insensitive on the control key", () => {
    expect(isPcfBundleUrl("https://org/webresources/samplenamespace.choicespicker/bundle.js", NS, CTOR)).toBe(true);
  });

  it("does NOT match the control's css/html sub-resources (only the bundle)", () => {
    expect(isPcfBundleUrl("https://org/webresources/SampleNamespace.ChoicesPicker/css/ChoicesPicker.css", NS, CTOR)).toBe(false);
    expect(isPcfBundleUrl("https://org/webresources/SampleNamespace.ChoicesPicker/ControlManifest.xml", NS, CTOR)).toBe(false);
  });

  it("does NOT match a different control's bundle", () => {
    expect(isPcfBundleUrl("https://org/webresources/OtherNs.OtherControl/bundle.js", NS, CTOR)).toBe(false);
  });

  it("does NOT match an unrelated bundle.js (no control key)", () => {
    expect(isPcfBundleUrl("https://org/webresources/acme_library/bundle.js", NS, CTOR)).toBe(false);
  });

  it("is false for empty inputs", () => {
    expect(isPcfBundleUrl("", NS, CTOR)).toBe(false);
    expect(isPcfBundleUrl("https://org/x/bundle.js", "", CTOR)).toBe(false);
    expect(isPcfBundleUrl("https://org/x/bundle.js", NS, "")).toBe(false);
  });
});

describe("pcf bundle helpers", () => {
  it("controlKey joins namespace.constructor lower-cased", () => {
    expect(controlKey(NS, CTOR)).toBe("samplenamespace.choicespicker");
  });

  it("CDP pattern over-matches on the bundle filename", () => {
    expect(pcfBundleCdpPattern()).toBe("*bundle.js*");
    expect(PCF_BUNDLE_FILENAME).toBe("bundle.js");
  });

  it("local bundle path is out/controls/<Constructor>/bundle.js under the control dir", () => {
    const p = pcfLocalBundlePath("/repo/control", CTOR).replace(/\\/g, "/");
    expect(p).toBe("/repo/control/out/controls/ChoicesPicker/bundle.js");
  });

  it("serves the bundle as JavaScript", () => {
    expect(pcfBundleContentType()).toBe("application/javascript");
  });
});
