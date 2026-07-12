import { describe, it, expect } from "vitest";
import { buildEnableArgs, buildDisableArgs, parseToolResult, profilerToolPath } from "./profilerCaptureTool";

describe("profiler capture tool arg builders (#63 capture)", () => {
  it("builds enable args with the step and default (no) max", () => {
    expect(buildEnableArgs("https://org.crm.dynamics.com", "11111111-1111-1111-1111-111111111111")).toEqual([
      "enable",
      "--url",
      "https://org.crm.dynamics.com",
      "--step",
      "11111111-1111-1111-1111-111111111111",
    ]);
  });

  it("adds --max when a positive limit is given, floored", () => {
    expect(buildEnableArgs("https://o", "s", 100)).toEqual(["enable", "--url", "https://o", "--step", "s", "--max", "100"]);
    expect(buildEnableArgs("https://o", "s", 5.9)).toEqual(["enable", "--url", "https://o", "--step", "s", "--max", "5"]);
    expect(buildEnableArgs("https://o", "s", 0)).toEqual(["enable", "--url", "https://o", "--step", "s"]);
  });

  it("builds disable args for the profiler step", () => {
    expect(buildDisableArgs("https://o", "22222222-2222-2222-2222-222222222222")).toEqual([
      "disable",
      "--url",
      "https://o",
      "--profiler-step",
      "22222222-2222-2222-2222-222222222222",
    ]);
  });
});

describe("profiler capture tool result parser", () => {
  it("parses a success line, ignoring stderr-style noise", () => {
    const stdout = '[profiler] Start Profiling step …\n{"profilerStepId":"abc","ok":true}\n';
    expect(parseToolResult(stdout)).toEqual({ profilerStepId: "abc", ok: true });
  });

  it("parses a failure line", () => {
    expect(parseToolResult('{"ok":false,"error":"boom"}')).toEqual({ ok: false, error: "boom" });
  });

  it("scans from the end so the last JSON object wins", () => {
    expect(parseToolResult('{"ok":false,"error":"stale"}\n{"ok":true,"disabled":true}')).toEqual({ ok: true, disabled: true });
  });

  it("returns an error result when there is no JSON line", () => {
    expect(parseToolResult("just logs, no json").ok).toBe(false);
    expect(parseToolResult("").ok).toBe(false);
  });

  it("ignores non-result braces (no ok field)", () => {
    expect(parseToolResult('{"note":"not a result"}\n{"ok":true}').ok).toBe(true);
  });
});

describe("profiler tool path", () => {
  it("points at the bundled exe under tools/pluginprofiler", () => {
    expect(profilerToolPath("/ext")).toMatch(/tools[\\/]pluginprofiler[\\/]DvptPluginProfiler\.exe$/);
  });
});
