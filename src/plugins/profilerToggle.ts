import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { runForComponent } from "../components/componentDiscovery";
import { ProjectTypes } from "../projectTypes/registry";
import { getOrganizationUrl } from "../general/connectionString";
import { canCallDataverseApi } from "../general/dataverse/connectionReady";
import {
  ActiveProfileStep,
  RegistrationKey,
  getProfilableSteps,
  findMatchingStep,
  deleteProfilerStep,
  getAssemblyStepStates,
  noProfilableStepsMessage,
} from "../general/dataverse/pluginProfiles";
import { parseRegistrationArgs } from "./registrationAttribute";
import { findPluginClasses } from "./profilerCodeLens";
import { isCaptureSupported, buildEnableArgs, buildDisableArgs, runProfilerTool } from "./profilerCaptureTool";
import { ensureCaptureToolRuntime } from "./profilerAssets";
import { ensureProfilerInstalled } from "./profilerCapture";
import { guidePluginProfiling } from "./profilerGuide";
import { refreshActiveProfiles, getActiveProfilesCache } from "../panel/panelDataCache";

// Per-step profiling toggle (#139): flip server-side profiling on/off for the step whose
// [CrmPluginRegistration(...)] attribute a CodeLens sits on. Enable/disable go through the
// Windows-only net48 tool; on other OSes the enable falls back to the guide and the disable to a
// Web-API delete of the profiler clone. State comes from the cached active-profiles list, never a
// per-render query. Both auth types — gate on the live connection, never tenantId.

const DEFAULT_MAX_PROFILED_EXECUTIONS = 100;

/** The class type name whose declaration follows the attribute at `attributeLine`. Pure. */
export function findEnclosingClassType(source: string, attributeLine: number): string | undefined {
  let best: string | undefined;
  let bestLine = Number.MAX_SAFE_INTEGER;
  for (const site of findPluginClasses(source)) {
    if (site.line >= attributeLine && site.line < bestLine) {
      best = site.typeName;
      bestLine = site.line;
    }
  }
  return best;
}

/** Read the registration attribute at `line` and build the match key (message/entity/type). */
async function keyForAttribute(uri: vscode.Uri, line: number): Promise<RegistrationKey | undefined> {
  const document = await vscode.workspace.openTextDocument(uri);
  const text = document.getText();
  const regex = /\[CrmPluginRegistration\(([\s\S]*?)\)\]/g;
  let match = regex.exec(text);
  while (match) {
    if (document.positionAt(match.index).line === line) {
      const parsed = parseRegistrationArgs(match[1] || "");
      if (!parsed) {
        return undefined;
      }
      return { message: parsed.message, primaryEntity: parsed.primaryEntity, typeName: findEnclosingClassType(text, line) };
    }
    match = regex.exec(text);
  }
  return undefined;
}

/** CodeLens command handler: toggle profiling for the step at (uri, line). */
export async function toggleStepProfiling(context: DataversePowerToolsContext, uri: vscode.Uri, line: number): Promise<void> {
  const key = await keyForAttribute(uri, line);
  if (!key) {
    vscode.window.showWarningMessage("Could not read the plugin step registration on this line.");
    return;
  }
  await runForComponent(context, ProjectTypes.plugin, uri, async (scoped) => {
    if (!canCallDataverseApi({ organizationUrl: scoped.dataverse?.organizationUrl, isValid: scoped.dataverse?.isValid })) {
      vscode.window.showErrorMessage("Connect to Dataverse first to change plug-in profiling.");
      return;
    }
    // The lens LABEL may read the cache (cheap, per-render), but the ACTION must not: a cache that had
    // not caught up made a second click start again instead of stopping, and a step being profiled is
    // disabled — so the start path could not find it either, and profiling could never be turned off
    // from the lens (#251). Confirm against the org before deciding.
    let active = findMatchingStep(getActiveProfilesCache(), key);
    if (!active) {
      await refreshActiveProfiles(scoped);
      active = findMatchingStep(getActiveProfilesCache(), key);
    }
    if (active) {
      await stopProfilingStep(scoped, active);
    } else {
      await startProfilingStep(scoped, key);
    }
    // Re-read until the org reflects the change, so the label and the Active profiles block tell the
    // truth: a clone is not always queryable the instant the tool returns.
    await settleActiveProfiles(scoped, key, !active);
  });
}

/**
 * Refresh the active-profiles cache until it reflects the change we just made, so the CodeLens label and
 * the panel's Active profiles block are not stale. Dataverse does not always return a just-created clone
 * immediately, and one read straight after the tool returned is what left the UI saying "Profile: Off"
 * with profiling on (#251). Gives up quietly after a few seconds — the panel refresh still happened.
 */
async function settleActiveProfiles(context: DataversePowerToolsContext, key: RegistrationKey, expectActive: boolean): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await refreshActiveProfiles(context);
    if (!!findMatchingStep(getActiveProfilesCache(), key) === expectActive) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

async function startProfilingStep(context: DataversePowerToolsContext, key: RegistrationKey): Promise<void> {
  if (!isCaptureSupported()) {
    await guidePluginProfiling(context);
    return;
  }
  const assemblyName = context.projectSettings.pluginProjectName as string | undefined;
  let steps = await getProfilableSteps(context, assemblyName);
  if (steps && steps.length === 0 && assemblyName) {
    steps = await getProfilableSteps(context);
  }
  if (!steps) {
    context.channel.appendLine("[Profiler] Could not list profilable steps (query failed) — see the output.");
    return;
  }
  const step = findMatchingStep(steps, key);
  if (!step) {
    vscode.window.showInformationMessage(
      `No deployed step matches ${key.message ?? "this message"}${key.primaryEntity ? " of " + key.primaryEntity : ""}. Deploy the plugin and register the step first.`,
    );
    return;
  }
  if (!(await ensureProfilerInstalled(context))) {
    return;
  }
  const runtimeDir = await ensureCaptureToolRuntime(context);
  if (!runtimeDir) {
    return;
  }
  const organizationUrl = getOrganizationUrl(context.connectionString);
  const result = await runProfilerTool(context, buildEnableArgs(organizationUrl, step.stepId, DEFAULT_MAX_PROFILED_EXECUTIONS), runtimeDir);
  if (!result.ok || !result.profilerStepId) {
    vscode.window.showErrorMessage(`Could not start profiling: ${result.error ?? "unknown error"}`);
    context.channel.show();
    return;
  }
  context.channel.appendLine(`[Profiler] Profiling ON for ${step.typeName} (${step.message ?? "?"} ${step.primaryEntity ?? ""}).`);
  vscode.window.showInformationMessage(`Profiling on: ${step.typeName}. Trigger it, then Download a run to debug.`);
}

/** Stop profiling a step: net48 disable on Windows, Web-API delete of the profiler clone elsewhere. */
export async function stopProfilingStep(context: DataversePowerToolsContext, profile: ActiveProfileStep): Promise<void> {
  const label = [profile.typeName, profile.message, profile.primaryEntity].filter(Boolean).join(" · ");
  if (!isCaptureSupported()) {
    const ok = await deleteProfilerStep(context, profile.profilerStepId);
    if (ok) {
      context.channel.appendLine(`[Profiler] Stopped profiling (deleted profiler step) for ${label}.`);
      context.channel.appendLine("[Profiler] Note: on non-Windows the original step may need re-enabling in the Plugin Registration Tool.");
    } else {
      vscode.window.showErrorMessage("Could not stop profiling — see the output.");
    }
    return;
  }
  const runtimeDir = await ensureCaptureToolRuntime(context);
  if (!runtimeDir) {
    return;
  }
  const organizationUrl = getOrganizationUrl(context.connectionString);
  const result = await runProfilerTool(context, buildDisableArgs(organizationUrl, profile.profilerStepId), runtimeDir);
  if (result.ok) {
    context.channel.appendLine(`[Profiler] Profiling OFF for ${label}.`);
  } else {
    vscode.window.showErrorMessage(`Could not stop profiling: ${result.error ?? "unknown error"}`);
    context.channel.show();
  }
}

/** Stop the profiled step at `index` in the active-profiles cache — the panel trash-can (#139). */
export async function stopActiveProfileByIndex(context: DataversePowerToolsContext, index: number): Promise<void> {
  const profile = getActiveProfilesCache()[index];
  if (!profile) {
    return;
  }
  if (!canCallDataverseApi({ organizationUrl: context.dataverse?.organizationUrl, isValid: context.dataverse?.isValid })) {
    vscode.window.showErrorMessage("Connect to Dataverse first to stop profiling.");
    return;
  }
  await stopProfilingStep(context, profile);
  await refreshActiveProfiles(context);
}
