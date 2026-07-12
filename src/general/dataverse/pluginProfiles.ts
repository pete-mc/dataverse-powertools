/* eslint-disable @typescript-eslint/naming-convention -- record fields are Dataverse logical names */
import DataversePowerToolsContext from "../../context";
import { dataverseApiUrl, logDataverseError, logDataverseHttpError } from "./webApi";
import { canCallDataverseApi } from "./connectionReady";

// Captured plug-in profiles via the Web API (#63 phase 2a). The Plugin Profiler
// (the PRT's managed solution, unique name "PluginProfiler") persists each
// captured execution as an mbs_pluginprofile row; the serialized report lives in
// the mbs_profile column. Read-only here. Works under BOTH auth types — the
// access token authorises the call, never gate on tenantId.

/** The profiler's managed solution unique name (ships with the Plugin Registration Tool). */
export const PROFILER_SOLUTION_UNIQUE_NAME = "PluginProfiler";

export interface PluginProfileRecord {
  mbs_pluginprofileid: string;
  mbs_typename?: string;
  mbs_messagename?: string;
  mbs_primaryentity?: string;
  /** 0 = synchronous, 1 = asynchronous (matches sdkmessageprocessingstep mode). */
  mbs_mode?: number;
  mbs_depth?: number;
  mbs_correlationid?: string;
  createdon?: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pure query builders — unit-tested; the live test proves them against a real org.
export function profilerInstalledQuery(): string {
  return `solutions?$select=solutionid,version&$filter=uniquename eq '${PROFILER_SOLUTION_UNIQUE_NAME}'`;
}

export function pluginProfilesQuery(top: number = 50): string {
  const select = ["mbs_pluginprofileid", "mbs_typename", "mbs_messagename", "mbs_primaryentity", "mbs_mode", "mbs_depth", "mbs_correlationid", "createdon"].join(",");
  return `mbs_pluginprofiles?$select=${select}&$orderby=createdon desc&$top=${Math.max(1, Math.floor(top))}`;
}

export function pluginProfileContentQuery(profileId: string): string {
  if (!GUID.test(profileId)) {
    throw new Error(`Not a plugin profile id: ${profileId}`);
  }
  return `mbs_pluginprofiles(${profileId})?$select=mbs_profile`;
}

async function getJson(context: DataversePowerToolsContext, operation: string, resourcePath: string): Promise<any | undefined> {
  const dataverse = context.dataverse;
  if (!dataverse || !canCallDataverseApi({ organizationUrl: dataverse.organizationUrl, isValid: dataverse.isValid })) {
    return undefined;
  }
  try {
    const url = dataverseApiUrl(dataverse.organizationUrl, resourcePath);
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: "Bearer " + (await dataverse.getAuthorizationToken()), "Content-Type": "application/json" },
    });
    if (!response.ok) {
      await logDataverseHttpError(context.channel, operation, response);
      return undefined;
    }
    return await response.json();
  } catch (error) {
    logDataverseError(context.channel, operation, error);
    return undefined;
  }
}

/** True/false when the org answered; undefined when the call failed (logged). */
export async function isProfilerInstalled(context: DataversePowerToolsContext): Promise<boolean | undefined> {
  const body = await getJson(context, "Check for the Plugin Profiler solution", profilerInstalledQuery());
  return body ? ((body.value?.length ?? 0) > 0 ? true : false) : undefined;
}

/** Captured profiles, newest first (without the heavy report column). Undefined on failure. */
export async function getPluginProfiles(context: DataversePowerToolsContext, top: number = 50): Promise<PluginProfileRecord[] | undefined> {
  const body = await getJson(context, "List captured plugin profiles", pluginProfilesQuery(top));
  return body ? ((body.value ?? []) as PluginProfileRecord[]) : undefined;
}

/** One profile's serialized report (the mbs_profile column). Undefined on failure/empty. */
export async function getPluginProfileContent(context: DataversePowerToolsContext, profileId: string): Promise<string | undefined> {
  const body = await getJson(context, "Download a plugin profile", pluginProfileContentQuery(profileId));
  const content = body?.mbs_profile;
  return typeof content === "string" && content.length > 0 ? content : undefined;
}
