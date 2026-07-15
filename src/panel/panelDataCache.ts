import DataversePowerToolsContext from "../context";
import { getTraceLogSetting, TraceLogLevel } from "../general/dataverse/traceLogSetting";
import { getActiveProfiles, ActiveProfileStep } from "../general/dataverse/pluginProfiles";
import { ProjectTypes } from "../projectTypes/registry";

// The actions panel is network-free (#100): computePanelState is called on every refresh and
// must not spawn network/process. Dataverse-derived panel data — the org trace-log level (#137)
// and the active-profiled steps (#139) — is therefore fetched ONCE on connect / explicit refresh
// and CACHED here; computePanelState (and the profiler CodeLens) read this cache synchronously.

let traceLog: TraceLogLevel | undefined;
let activeProfiles: ActiveProfileStep[] = [];

export function getTraceLogCache(): TraceLogLevel | undefined {
  return traceLog;
}

export function getActiveProfilesCache(): ActiveProfileStep[] {
  return activeProfiles;
}

/** Reset the cache (e.g. before switching environments so the previous org's values don't linger). */
export function clearPanelDataCache(): void {
  traceLog = undefined;
  activeProfiles = [];
}

function hasPluginComponent(context: DataversePowerToolsContext): boolean {
  return (context.components ?? []).some((component) => component.settings.type === ProjectTypes.plugin) || context.projectSettings?.type === ProjectTypes.plugin;
}

/** Re-fetch just the active-profiler-step cache (after a toggle / stop / block refresh) and
 * re-render the panel. Fetched only when a plugin component is present. */
export async function refreshActiveProfiles(context: DataversePowerToolsContext): Promise<void> {
  if (hasPluginComponent(context)) {
    const profiles = await getActiveProfiles(context);
    if (profiles !== undefined) {
      activeProfiles = profiles;
    }
  }
  context.refreshPanel?.();
}

/** Fetch all Dataverse-derived panel data on connect / explicit refresh and cache it, then
 * re-render. Gated on a live connection inside each getter — a no-op (undefined) offline, so
 * the previous good values survive a transient failure. Fire-and-forget from callers. */
export async function refreshPanelData(context: DataversePowerToolsContext): Promise<void> {
  const level = await getTraceLogSetting(context);
  if (level !== undefined) {
    traceLog = level;
  }
  if (hasPluginComponent(context)) {
    const profiles = await getActiveProfiles(context);
    if (profiles !== undefined) {
      activeProfiles = profiles;
    }
  }
  context.refreshPanel?.();
}
