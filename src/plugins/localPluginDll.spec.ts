import { describe, it, expect } from "vitest";
import { isLocalPluginDllPath } from "./profilerCapture";

// The pure path predicate behind the profiler package-assembly prep (#208): the deployed package's
// content isn't retrievable from Dataverse, so capture sources the assembly to populate from the
// LOCAL build output — `<name>.dll` under a bin/**/net4x path.

describe("isLocalPluginDllPath", () => {
  it("accepts the built assembly under bin/<config>/net462", () => {
    expect(isLocalPluginDllPath("c:/proj/myplugins/bin/debug/net462/myplugins.dll", "MyPlugins")).toBe(true);
    expect(isLocalPluginDllPath("c:/proj/myplugins/bin/release/net48/myplugins.dll", "MyPlugins")).toBe(true);
  });

  it("matches case-insensitively (predicate is given a lowercased path)", () => {
    expect(isLocalPluginDllPath("c:/proj/bin/debug/net462/myplugins.dll", "MyPlugins")).toBe(true);
  });

  it("rejects a different assembly, a non-bin path, or a non-net4x framework", () => {
    expect(isLocalPluginDllPath("c:/proj/bin/debug/net462/other.dll", "MyPlugins")).toBe(false);
    expect(isLocalPluginDllPath("c:/proj/out/myplugins.dll", "MyPlugins")).toBe(false);
    expect(isLocalPluginDllPath("c:/proj/bin/debug/net8.0/myplugins.dll", "MyPlugins")).toBe(false);
  });

  it("accepts a copy in a test project's bin (finder de-prioritises it, but the path is still valid)", () => {
    expect(isLocalPluginDllPath("c:/proj/myplugins.tests/bin/debug/net472/myplugins.dll", "MyPlugins")).toBe(true);
  });
});
