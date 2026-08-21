// "Replay & debug": actually replay the captured run, in VS Code, stopping on your breakpoints.
//
// The button used to only WRITE a test file — nothing ran and nothing was debugged, and you then had to
// go and run it yourself. Generating is still useful (it is what you commit and run in CI), so that is
// now its own button, "Generate Replay Test"; this one runs the replay under the debugger.
//
// Two things had to be right for a breakpoint in the PLUGIN to actually be hit, and the old
// Test-Explorer Debug profile got both wrong:
//
//  1. THE DEBUGGER. The adapter has to match the test project's framework: `clr` for .NET Framework,
//     `coreclr` for .NET. `coreclr` cannot debug a .NET Framework process; the session started and
//     symbols even resolved, but execution never stopped. Since #269 a new test project targets
//     net8.0 (the plug-in multi-targets net462;net8.0), so this resolves to `coreclr` — which is what
//     lets Replay & debug work off Windows at all. A Framework-pinned project still gets `clr`.
//  2. THE PROCESS. `dotnet test` does not run tests itself: it spawns a child **testhost** and the tests
//     run there. A launch config attached to the `dotnet test` driver therefore debugs the wrong process.
//     `VSTEST_HOST_DEBUG=1` makes the test host wait and print its own process id, which we attach to —
//     so the plugin executes inside the debuggee and breakpoints bind AND pause.
//
// The pure parts (framework → adapter, target framework from a csproj, the test-host pid, the arguments)
// are unit-tested; the orchestration below is thin.

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";
import { resolveTestProjectPath } from "./unitTesting";
import { generatePluginReplayTest } from "./replayTest";

/** VS Code debug adapter for a target framework: .NET Framework needs `clr`, .NET (Core) needs `coreclr`. */
export function debugTypeForFramework(targetFramework: string | undefined): "clr" | "coreclr" {
  return /^net4/i.test((targetFramework ?? "").trim()) ? "clr" : "coreclr";
}

/** `<TargetFramework>` (or the first of `<TargetFrameworks>`) from a csproj's text. */
export function targetFrameworkFromCsproj(csprojText: string): string | undefined {
  const single = /<TargetFramework>\s*([^<\s]+)\s*<\/TargetFramework>/i.exec(csprojText ?? "");
  if (single) {
    return single[1];
  }
  const multiple = /<TargetFrameworks>\s*([^<]+)\s*<\/TargetFrameworks>/i.exec(csprojText ?? "");
  return multiple ? multiple[1].split(";")[0].trim() || undefined : undefined;
}

/**
 * The test host's process id from `dotnet test` output when `VSTEST_HOST_DEBUG=1` is set.
 *
 * VSTest prints a line like:
 *   `Host debugging is enabled. Please attach debugger to testhost process to continue.`
 *   `Process Id: 12345, Name: testhost`
 * and then WAITS, which is what lets us attach before any test code runs.
 */
export function parseTestHostPid(output: string): number | undefined {
  const match = /Process\s+Id:\s*(\d+)/i.exec(output ?? "");
  if (!match) {
    return undefined;
  }
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

/** `dotnet test` arguments that run only the generated replay test(s). */
export function buildReplayTestArgs(testProject: string, filter = "FullyQualifiedName~Replay_"): string[] {
  return ["test", testProject, "--nologo", "-v", "minimal", "--filter", filter];
}

/** The attach configuration for the waiting test host. */
export function buildAttachConfig(processId: number, targetFramework: string | undefined): vscode.DebugConfiguration {
  return {
    type: debugTypeForFramework(targetFramework),
    request: "attach",
    name: "Replay plug-in profile",
    processId: String(processId),
  };
}

/** True when a generated replay test already exists in the test project's folder. */
export function findExistingReplayTest(testProjectDir: string): string | undefined {
  try {
    const match = fs.readdirSync(testProjectDir).find((name) => /^Replay_.*\.cs$/.test(name));
    return match ? path.join(testProjectDir, match) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Replay the captured profile under the debugger.
 *
 * Generates the replay test first when there isn't one, so the button works from a freshly downloaded
 * profile without making the user press two things.
 */
export async function replayAndDebug(context: DataversePowerToolsContext): Promise<void> {
  const componentRoot = activeComponentRoot(context);
  if (!componentRoot) {
    context.reportFailure("Open or select a plugin component first.");
    return;
  }

  const testProject = await resolveTestProjectPath(context, componentRoot);
  if (!testProject) {
    context.reportFailure("No unit test project found — run “Set up Tests” first, then Replay & debug.");
    return;
  }
  const testProjectDir = path.dirname(testProject);

  if (!findExistingReplayTest(testProjectDir)) {
    context.channel.appendLine("[Profiler] No replay test yet — generating one first.");
    await generatePluginReplayTest(context);
    if (!findExistingReplayTest(testProjectDir)) {
      return; // generation was cancelled or failed; it has already reported why
    }
  }

  const targetFramework = (() => {
    try {
      return targetFrameworkFromCsproj(fs.readFileSync(testProject, "utf8"));
    } catch {
      return undefined;
    }
  })();

  context.channel.show(true);
  context.channel.appendLine(`[Profiler] Replaying under the debugger (${debugTypeForFramework(targetFramework)}; ${targetFramework ?? "unknown framework"})…`);

  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Replaying the captured run under the debugger…" }, async () => {
    // VSTEST_HOST_DEBUG makes the TEST HOST wait for a debugger and print its pid — the only way a
    // breakpoint in the plugin can be hit, because that is the process the plugin actually runs in.
    /* eslint-disable @typescript-eslint/naming-convention -- environment variable name */
    const child = cp.spawn("dotnet", buildReplayTestArgs(testProject), {
      cwd: componentRoot,
      env: { ...process.env, VSTEST_HOST_DEBUG: "1" },
      shell: false,
    });
    /* eslint-enable @typescript-eslint/naming-convention */

    let attached = false;
    let output = "";
    let pending = "";
    /** Log whole LINES, not raw chunks: `append` bypasses the appendLine seams, so chunked output was
     *  invisible both to the test log mirror and to the activity feed's outcome tap (#229). */
    const logLines = (chunk: string): void => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        context.channel.appendLine(line);
      }
    };
    const attachWhenReady = async (chunk: string): Promise<void> => {
      output += chunk;
      logLines(chunk);
      if (attached) {
        return;
      }
      const pid = parseTestHostPid(output);
      if (pid === undefined) {
        return;
      }
      attached = true;
      context.channel.appendLine(`\n[Profiler] Attaching to the waiting test host (pid ${pid}).`);
      const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], buildAttachConfig(pid, targetFramework));
      if (!started) {
        context.reportFailure("Could not start the .NET debug session. Install the C# extension (ms-dotnettools.csharp), which provides the .NET debugger, then try again.");
        child.kill();
      }
    };

    child.stdout?.on("data", (data: Buffer) => void attachWhenReady(data.toString()));
    child.stderr?.on("data", (data: Buffer) => void attachWhenReady(data.toString()));

    await new Promise<void>((resolve) => {
      child.on("close", (code) => {
        if (pending) {
          context.channel.appendLine(pending);
          pending = "";
        }
        context.channel.appendLine(`[Profiler] Replay finished (exit code ${code ?? "unknown"}).`);
        // Say what the exit code MEANS, and let the activity feed show it (#229) instead of leaving a
        // failed replay looking like a completed one.
        if (!attached) {
          context.reportFailure("The test host never asked for a debugger, so no breakpoints could be hit — the replay ran without a debug session.");
        } else if (code !== 0) {
          // Stopping the debug session yourself also lands here, which is why this is a warning: the
          // replay did not finish green, but that is not necessarily a fault.
          context.reportWarning(`The replay did not finish green (exit code ${code ?? "unknown"}) — check the output above, or the debug session was stopped early.`);
        }
        resolve();
      });
      child.on("error", (error) => {
        context.reportFailure(`Could not run the replay: ${error.message}`);
        resolve();
      });
    });
  });
}
