import { describe, it, expect } from "vitest";
import { buildAttachConfig, buildReplayTestArgs, debugTypeForFramework, parseTestHostPid, targetFrameworkFromCsproj } from "./replayDebug";

// "Replay & debug" has to stop on a breakpoint inside the PLUGIN. Two things had to be right, and the
// old Test-Explorer Debug profile got both wrong — these tests pin them:
//
//   1. the ADAPTER: the generated test project targets net471 (.NET Framework), so `clr`, not `coreclr`;
//   2. the PROCESS: `dotnet test` spawns a child testhost and the tests run THERE, so the debugger must
//      attach to that process — which VSTEST_HOST_DEBUG makes possible by having it wait and print its pid.

describe("debugTypeForFramework", () => {
  it("uses clr for .NET Framework, which is what the generated test project targets", () => {
    expect(debugTypeForFramework("net471")).toBe("clr");
    expect(debugTypeForFramework("net462")).toBe("clr");
    expect(debugTypeForFramework("net48")).toBe("clr");
    expect(debugTypeForFramework("NET471")).toBe("clr");
    expect(debugTypeForFramework(" net471 ")).toBe("clr");
  });

  it("uses coreclr for modern .NET", () => {
    expect(debugTypeForFramework("net8.0")).toBe("coreclr");
    expect(debugTypeForFramework("net9.0")).toBe("coreclr");
    expect(debugTypeForFramework("netcoreapp3.1")).toBe("coreclr");
  });

  it("falls back to coreclr when the framework is unknown", () => {
    expect(debugTypeForFramework(undefined)).toBe("coreclr");
    expect(debugTypeForFramework("")).toBe("coreclr");
  });
});

describe("targetFrameworkFromCsproj", () => {
  it("reads a single target framework", () => {
    expect(targetFrameworkFromCsproj("<Project>\n  <PropertyGroup>\n    <TargetFramework>net471</TargetFramework>\n  </PropertyGroup>\n</Project>")).toBe("net471");
  });

  it("takes the first of several", () => {
    expect(targetFrameworkFromCsproj("<TargetFrameworks>net471;net8.0</TargetFrameworks>")).toBe("net471");
  });

  it("tolerates whitespace and casing", () => {
    expect(targetFrameworkFromCsproj("<targetframework>  net48  </targetframework>")).toBe("net48");
  });

  it("returns undefined when absent", () => {
    expect(targetFrameworkFromCsproj("<Project></Project>")).toBeUndefined();
    expect(targetFrameworkFromCsproj("")).toBeUndefined();
  });
});

describe("parseTestHostPid", () => {
  it("reads the pid VSTest prints while waiting for a debugger", () => {
    const output = [
      "Host debugging is enabled. Please attach debugger to testhost process to continue.",
      "Process Id: 12345, Name: testhost",
      "Waiting for debugger attach...",
    ].join("\n");
    expect(parseTestHostPid(output)).toBe(12345);
  });

  it("tolerates spacing and casing", () => {
    expect(parseTestHostPid("process id:   777")).toBe(777);
  });

  it("returns undefined before the line appears, so we do not attach to nothing", () => {
    expect(parseTestHostPid("Determining projects to restore...")).toBeUndefined();
    expect(parseTestHostPid("")).toBeUndefined();
    expect(parseTestHostPid("Process Id: notanumber")).toBeUndefined();
  });
});

describe("buildReplayTestArgs", () => {
  it("runs only the generated replay test(s)", () => {
    expect(buildReplayTestArgs("C:/w/My.Tests/My.Tests.csproj")).toEqual([
      "test",
      "C:/w/My.Tests/My.Tests.csproj",
      "--nologo",
      "-v",
      "minimal",
      "--filter",
      "FullyQualifiedName~Replay_",
    ]);
  });

  it("accepts a narrower filter", () => {
    expect(buildReplayTestArgs("p.csproj", "FullyQualifiedName=Ns.Replay_X.ReplayCapturedProfile")).toContain("FullyQualifiedName=Ns.Replay_X.ReplayCapturedProfile");
  });
});

describe("buildAttachConfig", () => {
  it("attaches to the waiting test host with the right adapter", () => {
    expect(buildAttachConfig(4321, "net471")).toEqual({ type: "clr", request: "attach", name: "Replay plug-in profile", processId: "4321" });
  });

  it("uses coreclr for a modern target", () => {
    expect(buildAttachConfig(9, "net8.0").type).toBe("coreclr");
  });

  it("passes the pid as a string, which is what the debug adapter expects", () => {
    expect(buildAttachConfig(15, "net471").processId).toBe("15");
  });
});
