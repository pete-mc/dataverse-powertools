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

export interface ProfilableStep {
  stepId: string;
  name: string;
  typeName: string;
  message?: string;
  primaryEntity?: string;
  /** 0 = synchronous, 1 = asynchronous. */
  mode?: number;
}

/** Steps that can be profiled (Start Profiling), optionally scoped to one plugin
 * assembly. Joins step -> plugintype -> pluginassembly and drops the profiler's own
 * "(Profiled)" clones. Read-only. Undefined on failure. */
export async function getProfilableSteps(context: DataversePowerToolsContext, assemblyName?: string): Promise<ProfilableStep[] | undefined> {
  const expand =
    "$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode),eventhandler_plugintype($select=typename;$expand=pluginassemblyid($select=name))";
  const resource = `sdkmessageprocessingsteps?$select=name,mode,statecode&${expand}&$filter=statecode eq 0&$top=200`;
  const body = await getJson(context, "List profilable plugin steps", resource);
  if (!body) {
    return undefined;
  }
  const rows: any[] = body.value ?? [];
  return rows
    .map((row) => {
      const type = row.eventhandler_plugintype;
      return {
        stepId: row.sdkmessageprocessingstepid as string,
        name: (row.name as string) ?? "",
        typeName: (type?.typename as string) ?? "",
        assemblyName: (type?.pluginassemblyid?.name as string) ?? "",
        message: row.sdkmessageid?.name as string | undefined,
        primaryEntity: row.sdkmessagefilterid?.primaryobjecttypecode as string | undefined,
        mode: row.mode as number | undefined,
      };
    })
    .filter((step) => step.typeName && !step.typeName.startsWith("Microsoft.") && !/\(Profiled\)/.test(step.name))
    .filter((step) => !assemblyName || step.assemblyName === assemblyName)
    .map(({ assemblyName: _assemblyName, ...step }) => step);
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

function newGuid(): string {
  const bytes = require("crypto").randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Import a solution (the Plugin Profiler managed solution) via the Web API
 * ImportSolution action. Synchronous — resolves when the import completes. Returns
 * true on success. Works under both auth types (token authorises the call). */
export async function importSolution(context: DataversePowerToolsContext, customizationFileBase64: string): Promise<boolean> {
  const dataverse = context.dataverse;
  if (!dataverse || !canCallDataverseApi({ organizationUrl: dataverse.organizationUrl, isValid: dataverse.isValid })) {
    return false;
  }
  try {
    const url = dataverseApiUrl(dataverse.organizationUrl, "ImportSolution");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + (await dataverse.getAuthorizationToken()), "Content-Type": "application/json" },
      body: JSON.stringify({
        OverwriteUnmanagedCustomizations: false,
        PublishWorkflows: false,
        CustomizationFile: customizationFileBase64,
        ImportJobId: newGuid(),
      }),
    });
    if (!response.ok) {
      await logDataverseHttpError(context.channel, "Import the Plugin Profiler solution", response);
      return false;
    }
    return true;
  } catch (error) {
    logDataverseError(context.channel, "Import the Plugin Profiler solution", error);
    return false;
  }
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
