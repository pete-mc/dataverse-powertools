import { describe, it, expect } from "vitest";
import { buildDebugLaunchConfig } from "./pluginTestController";

// The Test Explorer's Debug profile is the product's answer to "F5-debug a captured production run"
// (#210): debugging the generated Replay_*.cs re-executes the real plugin in-process, so a breakpoint
// inside the PLUGIN binds. The debug ADAPTER belongs to the C# extension, but this configuration is
// ours — and it is the part that can be verified without a debugger present, which is why it lives in
// a pure function. The e2e suite proves the other half (a breakpoint really binds and pauses).

describe("plugin test debug launch configuration", () => {
  const cwd = "C:/work/MyPlugin";
  const project = "C:/work/MyPlugin/MyPlugin.Tests/MyPlugin.Tests.csproj";

  it("uses the C# extension's coreclr adapter", () => {
    const config = buildDebugLaunchConfig(project, cwd, []);
    expect(config.type).toBe("coreclr");
    expect(config.request).toBe("launch");
    expect(config.name).toBe("Debug Plugin Tests");
  });

  it("debugs `dotnet test` on the test project, so the plugin's own symbols load in the host", () => {
    const config = buildDebugLaunchConfig(project, cwd, []);
    expect(config.program).toBe("dotnet");
    expect(config.args).toEqual(["test", project]);
    expect(config.cwd).toBe(cwd);
  });

  it("passes a VSTest filter through when one test was requested", () => {
    const filter = ["--filter", "FullyQualifiedName=Ns.Replay_MyPlugin_20260812.ReplayCapturedProfile"];
    expect(buildDebugLaunchConfig(project, cwd, filter).args).toEqual(["test", project, ...filter]);
  });

  it("does not stop at entry — the breakpoint the user set is the point", () => {
    expect(buildDebugLaunchConfig(project, cwd, []).stopAtEntry).toBe(false);
  });

  it("keeps output in the internal console rather than stealing a terminal", () => {
    expect(buildDebugLaunchConfig(project, cwd, []).console).toBe("internalConsole");
  });

  it("does not mutate the caller's filter array", () => {
    const filter = ["--filter", "X"];
    buildDebugLaunchConfig(project, cwd, filter);
    expect(filter).toEqual(["--filter", "X"]);
  });
});
