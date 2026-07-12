import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import DataversePowerToolsContext from "../context";

// Wrapper around the bundled Windows-only net48 capture tool (profiler-tool/,
// shipped as tools/pluginprofiler/DvptPluginProfiler.exe). It drives the Plugin
// Profiler's EnablePlugin/DisablePlugin headlessly — the piece raw Web-API calls
// can't do (the profiler only becomes pipeline-executable via that API). The exe
// authenticates with the extension's own token (DVPT_TOKEN) so it works under both
// auth types. Pure arg builders + result parser live here (unit-tested); the run
// itself is Windows-gated and resolves the exe's PRT dependencies at runtime.

export interface ProfilerToolResult {
  ok: boolean;
  profilerStepId?: string;
  disabled?: boolean;
  error?: string;
}

/** Args for `enable` (Start Profiling a step). Pure. */
export function buildEnableArgs(organizationUrl: string, stepId: string, maxExecutions?: number): string[] {
  const args = ["enable", "--url", organizationUrl, "--step", stepId];
  if (maxExecutions && maxExecutions > 0) {
    args.push("--max", String(Math.floor(maxExecutions)));
  }
  return args;
}

/** Args for `disable` (Stop Profiling). Pure. */
export function buildDisableArgs(organizationUrl: string, profilerStepId: string): string[] {
  return ["disable", "--url", organizationUrl, "--profiler-step", profilerStepId];
}

/** Parse the tool's single JSON result line out of stdout (it also logs to stderr).
 * Scans from the end so trailing output wins. Pure. */
export function parseToolResult(stdout: string): ProfilerToolResult {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.ok === "boolean") {
          return parsed as ProfilerToolResult;
        }
      } catch {
        /* not the JSON line — keep scanning */
      }
    }
  }
  return { ok: false, error: "no result from the profiler tool" };
}

/** Path to the bundled capture exe. */
export function profilerToolPath(extensionPath: string): string {
  return path.join(extensionPath, "tools", "pluginprofiler", "DvptPluginProfiler.exe");
}

/** Capture (Start/Stop Profiling) is Windows-only — the tool is net48 and depends
 * on the .NET-Framework CrmServiceClient. Non-Windows uses the manual profile path. */
export function isCaptureSupported(): boolean {
  return process.platform === "win32";
}

/** Run the capture tool with the extension's token. `runtimeDir` holds a copy of the
 * exe next to the full PRT assemblies (see ensureCaptureToolRuntime) so .NET Framework
 * resolves its dependencies. Returns the parsed result. */
export async function runProfilerTool(context: DataversePowerToolsContext, args: string[], runtimeDir: string): Promise<ProfilerToolResult> {
  if (!isCaptureSupported()) {
    return { ok: false, error: "Plugin profiling capture is Windows-only. On macOS/Linux, capture in the Plugin Registration Tool, then Download or drop in the profile." };
  }
  const exe = path.join(runtimeDir, "DvptPluginProfiler.exe");
  if (!fs.existsSync(exe)) {
    return { ok: false, error: `Capture tool not found at ${exe}. Reinstall/update the extension.` };
  }
  const dataverse = context.dataverse;
  if (!dataverse?.isValid) {
    return { ok: false, error: "No valid Dataverse connection." };
  }
  const token = await dataverse.getAuthorizationToken();

  return new Promise<ProfilerToolResult>((resolve) => {
    // Run the exe from its runtime dir so the CLR resolves PluginProfiler.Library /
    // Microsoft.Xrm.Tooling.Connector alongside it. Token via env, never argv.
    const childEnv = { ...process.env, DVPT_TOKEN: token }; // eslint-disable-line @typescript-eslint/naming-convention -- env var name
    cp.execFile(exe, args, { cwd: runtimeDir, env: childEnv, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (stderr) {
        context.channel.appendLine(stderr.trimEnd());
      }
      const result = parseToolResult(stdout || "");
      if (error && result.ok !== false) {
        resolve({ ok: false, error: error.message });
        return;
      }
      resolve(result);
    });
  });
}
