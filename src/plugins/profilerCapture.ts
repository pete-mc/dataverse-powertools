import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";
import { isProfilerInstalled, importSolution, getProfilableSteps, ProfilableStep } from "../general/dataverse/pluginProfiles";
import { getOrganizationUrl } from "../general/connectionString";
import { isCaptureSupported, buildEnableArgs, buildDisableArgs, runProfilerTool } from "./profilerCaptureTool";
import { ensureCaptureToolRuntime, getProfilerSolutionBase64 } from "./profilerAssets";
import { downloadPluginProfiles } from "./downloadProfiles";

// "Profile the next run" (#63 capture, Windows-only): Start Profiling a registered
// step via the bundled net48 tool, ask the user to trigger the plugin, then fetch the
// captured execution (the download flow's execution picker handles multiple runs) and
// Stop Profiling. On non-Windows this defers to the manual download/file path.

const DEFAULT_MAX_PROFILED_EXECUTIONS = 100;

/** QuickPick label for a step to profile. Pure. */
export function stepPickLabel(step: ProfilableStep): { label: string; description: string } {
  const mode = step.mode === 1 ? "async" : "sync";
  return {
    label: step.typeName,
    description: [step.message, step.primaryEntity, mode, step.name].filter(Boolean).join(" · "),
  };
}

/** Install the Plugin Profiler managed solution (from the PRT NuGet) via ImportSolution
 * when it's missing — so capture is one-click instead of "go install it in PRT". Shown
 * with progress; returns true when the profiler is present afterwards. */
/** Ensure the Plugin Profiler managed solution is installed (checking, then one-click importing
 * when missing) so enable/disable can run. Returns true when the profiler is present afterwards;
 * false (with an error surfaced) when the org couldn't be reached or the install failed. */
export async function ensureProfilerInstalled(context: DataversePowerToolsContext): Promise<boolean> {
  const installed = await isProfilerInstalled(context);
  if (installed === undefined) {
    vscode.window.showErrorMessage("Could not reach Dataverse to check for the Plugin Profiler — see the output.");
    return false;
  }
  if (!installed) {
    return installProfilerSolution(context);
  }
  return true;
}

async function installProfilerSolution(context: DataversePowerToolsContext): Promise<boolean> {
  const base64 = await getProfilerSolutionBase64(context);
  if (!base64) {
    vscode.window.showErrorMessage("Could not fetch the Plugin Profiler solution — see the output.");
    context.channel.show();
    return false;
  }
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Installing the Plugin Profiler (one-time)…", cancellable: false }, async () => {
    const ok = await importSolution(context, base64);
    if (!ok) {
      vscode.window.showErrorMessage("Could not install the Plugin Profiler solution — see the output.");
      context.channel.show();
    } else {
      context.channel.appendLine("[Profiler] Plugin Profiler solution installed.");
    }
    return ok;
  });
}

export async function capturePluginRun(context: DataversePowerToolsContext): Promise<void> {
  const componentRoot = activeComponentRoot(context);
  if (!componentRoot) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  if (!isCaptureSupported()) {
    const choice = await vscode.window.showInformationMessage(
      "Starting a profile capture is Windows-only. On macOS/Linux, capture in the Plugin Registration Tool, then download or drop in the profile.",
      "Download a captured profile",
    );
    if (choice === "Download a captured profile") {
      await downloadPluginProfiles(context);
    }
    return;
  }

  if (!(await ensureProfilerInstalled(context))) {
    return;
  }

  // Prefer this project's own assembly; fall back to any custom step if none match
  // (e.g. the plugin isn't deployed under the expected assembly name).
  const assemblyName = context.projectSettings.pluginProjectName as string | undefined;
  let steps = await getProfilableSteps(context, assemblyName);
  if (steps && steps.length === 0 && assemblyName) {
    steps = await getProfilableSteps(context);
  }
  if (!steps) {
    context.channel.appendLine("[Profiler] Could not list profilable steps (query failed) — see the output.");
    return;
  }
  if (steps.length === 0) {
    vscode.window.showInformationMessage("No registered plugin steps to profile. Deploy your plugin and register a step (CodeLens) first.");
    return;
  }

  let step: ProfilableStep | undefined = steps[0];
  if (steps.length > 1) {
    const pick = await vscode.window.showQuickPick(
      steps.map((s) => ({ ...stepPickLabel(s), target: s })),
      { placeHolder: "Profile which plugin step?", ignoreFocusOut: true },
    );
    step = pick?.target;
  }
  if (!step) {
    return;
  }

  const runtimeDir = await ensureCaptureToolRuntime(context);
  if (!runtimeDir) {
    return;
  }
  const organizationUrl = getOrganizationUrl(context.connectionString);

  const enabled = await runProfilerTool(context, buildEnableArgs(organizationUrl, step.stepId, DEFAULT_MAX_PROFILED_EXECUTIONS), runtimeDir);
  if (!enabled.ok || !enabled.profilerStepId) {
    vscode.window.showErrorMessage(`Could not start profiling: ${enabled.error ?? "unknown error"}`);
    context.channel.show();
    return;
  }
  const profilerStepId = enabled.profilerStepId;
  context.channel.appendLine(`[Profiler] Started profiling ${step.typeName} (${step.message ?? "?"} ${step.primaryEntity ?? ""}).`);

  try {
    const go = await vscode.window.showInformationMessage(
      `Profiling started for ${step.typeName}. Now trigger it — ${step.message ?? "run"} ${step.primaryEntity ? "a " + step.primaryEntity + " record" : "the operation"} in your app — then click Continue to fetch the captured run.`,
      { modal: true },
      "Continue",
    );
    if (go === "Continue") {
      await downloadPluginProfiles(context);
    }
  } finally {
    const disabled = await runProfilerTool(context, buildDisableArgs(organizationUrl, profilerStepId), runtimeDir);
    context.channel.appendLine(disabled.ok ? "[Profiler] Stopped profiling." : `[Profiler] Stop profiling failed: ${disabled.error ?? "unknown"}`);
  }
}
