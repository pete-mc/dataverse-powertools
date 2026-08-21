import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { runForComponent } from "../components/componentDiscovery";
import { ProjectTypes } from "../projectTypes/registry";
import { canCallDataverseApi } from "../general/dataverse/connectionReady";
import { ActiveProfileStep, RegistrationKey, getProfilableSteps, findMatchingStep, getAssemblyStepStates, noProfilableStepsMessage } from "../general/dataverse/pluginProfiles";
import { parseRegistrationArgs } from "./registrationAttribute";
import { findPluginClasses } from "./profilerCodeLens";
import { enableStepProfiling, disableStepProfiling } from "../general/dataverse/profilerSteps";
import { ensureProfilerInstalled } from "./profilerCapture";
import { refreshDecorationCodeLenses } from "./decorationsCodeLens";
import { refreshActiveProfiles, getActiveProfilesCache } from "../panel/panelDataCache";

// Per-step profiling toggle (#139): flip server-side profiling on/off for the step whose
// [CrmPluginRegistration(...)] attribute a CodeLens sits on. Enable/disable go through the Web API
// (src/general/dataverse/profilerSteps.ts) and work on every OS since #264. State comes from the
// cached active-profiles list, never a per-render query. Both auth types — gate on the live
// connection, never tenantId.

const DEFAULT_MAX_PROFILED_EXECUTIONS = 100;

/** Human-readable label for a registration key or an active profile, for the log. Pure. */
export function describeKey(key: { typeName?: string; message?: string; primaryEntity?: string }): string {
  const name = key.typeName ?? "this step";
  const qualifier = [key.message, key.primaryEntity].filter(Boolean).join(" ");
  return qualifier ? `${name} (${qualifier})` : name;
}

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
  // The VERY first statement of the command, before reading the document and before
  // runForComponent. Measurement drove this: with the announcement inside runForComponent's
  // callback, the log showed "Current state confirmed in 0s" and "Toggle finished in 3s" — the
  // profiler work is fast — yet a gate on that first line still expired after 60s. Everything the
  // command does is quick; resolving the component around it is not. An announcement that sits
  // behind the slow part cannot tell you the slow part is running, which is the whole lesson of
  // #261: the toggle was never six minutes of work, it was seconds of work behind a silent wait.
  const requestedAt = Date.now();
  context.channel.appendLine(`[Profiler] Toggle requested on line ${line + 1} — resolving component…`);

  const key = await keyForAttribute(uri, line);
  if (!key) {
    context.channel.appendLine("[Profiler] No readable [CrmPluginRegistration] on that line — nothing to toggle.");
    vscode.window.showWarningMessage("Could not read the plugin step registration on this line.");
    return;
  }
  await runForComponent(context, ProjectTypes.plugin, uri, async (scoped) => {
    scoped.channel.appendLine(`[Profiler] Component resolved in ${Math.round((Date.now() - requestedAt) / 1000)}s; confirming current state for ${describeKey(key)}…`);
    if (!canCallDataverseApi({ organizationUrl: scoped.dataverse?.organizationUrl, isValid: scoped.dataverse?.isValid })) {
      scoped.channel.appendLine("[Profiler] Not connected to Dataverse — cannot change profiling.");
      vscode.window.showErrorMessage("Connect to Dataverse first to change plug-in profiling.");
      return;
    }
    // The lens LABEL may read the cache (cheap, per-render), but the ACTION must not: a cache that had
    // not caught up made a second click start again instead of stopping, and a step being profiled is
    // disabled — so the start path could not find it either, and profiling could never be turned off
    // from the lens (#251).
    //
    // Confirm against the org in BOTH directions. Refreshing only when the cache said "not active"
    // left a stale ACTIVE entry trusted outright, so a click meant to START profiling took the stop
    // branch against a clone that was no longer there — the mirror image of #251, and invisible in
    // the log until the lines above existed.
    const confirmStartedAt = Date.now();
    await refreshActiveProfiles(scoped);
    const active = findMatchingStep(getActiveProfilesCache(), key);
    scoped.channel.appendLine(`[Profiler] Current state confirmed in ${Math.round((Date.now() - confirmStartedAt) / 1000)}s: profiling is ${active ? "ON" : "OFF"}.`);
    // Announce BEFORE the work, and show progress while it runs. Until #261 this path logged
    // nothing at all until it finished, so a toggle that took minutes against a slow org was
    // indistinguishable from a click that never landed — for the user AND for the e2e, which sat on
    // a single "Profiling ON" gate with no way to tell "still working" from "never started".
    scoped.channel.appendLine(`[Profiler] ${active ? "Stopping" : "Starting"} profiling for ${describeKey(active ?? key)}…`);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `${active ? "Stopping" : "Starting"} plug-in profiling…`, cancellable: false },
      async () => {
        if (active) {
          await stopProfilingStep(scoped, active);
        } else {
          await startProfilingStep(scoped, key);
        }
        // Re-read until the org reflects the change, so the label and the Active profiles block tell
        // the truth: a clone is not always queryable the instant the tool returns.
        await settleActiveProfiles(scoped, key, !active);
      },
    );
    scoped.channel.appendLine(`[Profiler] Toggle finished in ${Math.round((Date.now() - requestedAt) / 1000)}s.`);
    // Settling updates the cache; this makes the LENS re-read it. Without it the label kept saying
    // whatever it said when the file was opened (#251) — the part of that bug you could actually see.
    refreshDecorationCodeLenses();
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
    // Channel line as well as the toast: this used to return with nothing in the log, so the only
    // evidence anything happened was a notification the user may have missed entirely.
    context.channel.appendLine(`[Profiler] No deployed step matches ${describeKey(key)} — deploy the plug-in and register the step first.`);
    vscode.window.showInformationMessage(
      `No deployed step matches ${key.message ?? "this message"}${key.primaryEntity ? " of " + key.primaryEntity : ""}. Deploy the plugin and register the step first.`,
    );
    return;
  }
  if (!(await ensureProfilerInstalled(context))) {
    return;
  }
  const result = await enableStepProfiling(context, step.stepId, DEFAULT_MAX_PROFILED_EXECUTIONS);
  if (!result.ok || !result.profilerStepId) {
    vscode.window.showErrorMessage(`Could not start profiling: ${result.error ?? "unknown error"}`);
    context.channel.show();
    return;
  }
  context.channel.appendLine(`[Profiler] Profiling ON for ${step.typeName} (${step.message ?? "?"} ${step.primaryEntity ?? ""}).`);
  vscode.window.showInformationMessage(`Profiling on: ${step.typeName}. Trigger it, then Download a run to debug.`);
}

/** Stop profiling a step: remove the profiler clone and restore the original (name, images,
 * enabled state). Cross-platform since #264 — this used to be a Windows-only net48 tool, with a
 * fallback elsewhere that deleted the clone and left the user's step DISABLED. */
export async function stopProfilingStep(context: DataversePowerToolsContext, profile: ActiveProfileStep): Promise<void> {
  const label = [profile.typeName, profile.message, profile.primaryEntity].filter(Boolean).join(" · ");
  const result = await disableStepProfiling(context, profile.profilerStepId);
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
