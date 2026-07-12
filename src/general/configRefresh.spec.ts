import { describe, expect, it } from "vitest";
import { isConfigStale } from "./configRefresh";
import { getProjectTypeDescriptor } from "../projectTypes/registry";

describe("isConfigStale", () => {
  const webresources = getProjectTypeDescriptor("webresources")!;

  it("flags projects stamped below the type's revision (or unstamped)", () => {
    expect(isConfigStale({ type: "webresources" }, webresources)).toBe(true);
    expect(isConfigStale({ type: "webresources", configRevision: 0 }, webresources)).toBe(true);
  });

  it("passes projects at (or above) the current revision", () => {
    expect(isConfigStale({ type: "webresources", configRevision: webresources.configRevision }, webresources)).toBe(false);
    expect(isConfigStale({ type: "webresources", configRevision: 99 }, webresources)).toBe(false);
  });

  it("never flags types with no refreshable files (detection disabled)", () => {
    expect(isConfigStale({ type: "plugin" }, getProjectTypeDescriptor("plugin"))).toBe(false);
    expect(isConfigStale({ type: "x" }, undefined)).toBe(false);
  });

  it("webresources allowlist holds only extension-owned files — never user code", () => {
    expect(webresources.refreshableFiles).toContain("webpack.common.js");
    expect(webresources.refreshableFiles).toContain("jest.config.js");
    expect(webresources.refreshableFiles).not.toContain("library.ts");
    expect(webresources.refreshableFiles).not.toContain(".gitignore");
  });
});
