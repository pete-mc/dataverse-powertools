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

/**
 * Build the sdkmessageprocessingsteps query for profilable steps (pure, unit-tested).
 *
 * When an `assemblyName` is known we filter SERVER-SIDE to that plugin assembly
 * (`plugintypeid/pluginassemblyid/name eq '…'`). Without it, the query returned the first 200
 * active steps and filtered client-side — but a busy org has hundreds of system (Microsoft.*)
 * steps that fill the whole `$top=200` page, so a freshly-registered user step never appeared and
 * capture dead-ended with "No registered plugin steps to profile". The assembly filter returns
 * only the user's own steps regardless of how many system steps exist.
 */
export function buildProfilableStepsResource(assemblyName?: string): string {
  // #135: expand the DEDICATED `plugintypeid` lookup — NOT the polymorphic `eventhandler`
  // (which targets plugintype OR serviceendpoint and doesn't populate `typename` for a
  // normally-registered plugin step, so every row was dropped). The Microsoft docs query a
  // step's plugin type via `plugintypeid($select=...)` and a webhook's via
  // `eventhandler_serviceendpoint`. `_plugintypeid_value ne null` keeps plugin steps and
  // excludes webhook/service-endpoint steps server-side.
  const expand = "$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode),plugintypeid($select=typename;$expand=pluginassemblyid($select=name))";
  const filters = ["statecode eq 0", "_plugintypeid_value ne null"];
  if (assemblyName) {
    filters.push(`plugintypeid/pluginassemblyid/name eq '${assemblyName.replace(/'/g, "''")}'`);
  }
  return `sdkmessageprocessingsteps?$select=name,mode,statecode&${expand}&$filter=${filters.join(" and ")}&$top=200`;
}

/** Steps that can be profiled (Start Profiling), optionally scoped to one plugin
 * assembly. Joins step -> plugintype -> pluginassembly and drops the profiler's own
 * "(Profiled)" clones. Read-only. Undefined on failure. */
export async function getProfilableSteps(context: DataversePowerToolsContext, assemblyName?: string): Promise<ProfilableStep[] | undefined> {
  const resource = buildProfilableStepsResource(assemblyName);
  const body = await getJson(context, "List profilable plugin steps", resource);
  if (!body) {
    return undefined;
  }
  const steps = parseProfilableSteps(body, assemblyName);
  // #135: the query succeeded but every step was filtered out — log WHY so a "No registered
  // plugin steps" dead-end is diagnosable (which bucket the user's live step fell into).
  if (steps.length === 0 && (body?.value?.length ?? 0) > 0) {
    const d = profilableStepsDiagnostics(body, assemblyName);
    context.channel.appendLine(
      `[Profiler] ${d.total} active step(s) returned but none were profilable${assemblyName ? ` for assembly "${assemblyName}"` : ""}: ` +
        `${d.droppedNoType} without a resolved plugin type, ${d.droppedSystem} system (Microsoft.*), ` +
        `${d.droppedProfiled} already-profiled clones, ${d.droppedByAssembly} in other assemblies. ` +
        (d.droppedNoType > 0
          ? `A registered, firing step counted under "without a resolved plugin type" means its plugintype expand came back empty — redeploy the plugin and retry; if it persists, report the step name.`
          : ""),
    );
  }
  return steps;
}

export interface ProfilableStepsDiagnostics {
  total: number;
  kept: number;
  droppedNoType: number;
  droppedSystem: number;
  droppedProfiled: number;
  droppedByAssembly: number;
}

/**
 * Classify each returned step by why parseProfilableSteps keeps or drops it (pure,
 * unit-tested). Mirrors the same filter order so the counts explain an empty result — the
 * diagnostic behind #135's "No registered plugin steps to profile".
 */
export function profilableStepsDiagnostics(body: any, assemblyName?: string): ProfilableStepsDiagnostics {
  const rows: any[] = body?.value ?? [];
  const diag: ProfilableStepsDiagnostics = { total: rows.length, kept: 0, droppedNoType: 0, droppedSystem: 0, droppedProfiled: 0, droppedByAssembly: 0 };
  for (const row of rows) {
    const type = row.plugintypeid;
    const typeName = (type?.typename as string) ?? "";
    const name = (row.name as string) ?? "";
    const stepAssembly = (type?.pluginassemblyid?.name as string) ?? "";
    if (!typeName) {
      diag.droppedNoType++;
    } else if (typeName.startsWith("Microsoft.")) {
      diag.droppedSystem++;
    } else if (/\(Profiled\)/.test(name)) {
      diag.droppedProfiled++;
    } else if (assemblyName && stepAssembly !== assemblyName) {
      diag.droppedByAssembly++;
    } else {
      diag.kept++;
    }
  }
  return diag;
}

/**
 * Shape + filter the sdkmessageprocessingsteps response into profilable steps (pure,
 * unit-tested). Reads the step's plugin type from the dedicated `plugintypeid` expand
 * (#135 — the polymorphic `eventhandler_plugintype` didn't populate `typename` for normal
 * plugin steps). Drops rows without a resolved typeName, system (Microsoft.*) steps, and
 * the profiler's own "(Profiled)" clones; optionally scopes to one assembly.
 */
export function parseProfilableSteps(body: any, assemblyName?: string): ProfilableStep[] {
  const rows: any[] = body?.value ?? [];
  return rows
    .map((row) => {
      const type = row.plugintypeid;
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

// --- Active (server-side-enabled) plug-in profiles (#139) ---
//
// When a step is profiled, the Plugin Profiler registers a CLONE of the step whose name
// carries a "(Profiled)" marker (the same marker parseProfilableSteps drops so the clone
// isn't offered for profiling again). That clone's OWN sdkmessageprocessingstepid is the
// `profiler-step` the net48 tool's `disable` takes, so an active profile row = a profiled
// clone. Read-only; works under both auth types.

const PROFILED_MARKER = /\s*\(Profiled\)\s*$/;

export interface ActiveProfileStep {
  /** The profiler clone's step id — the `--profiler-step` disable/delete targets. */
  profilerStepId: string;
  /** Cleaned type/label parsed from the clone's name (the "(Profiled)" suffix stripped). */
  typeName: string;
  message?: string;
  primaryEntity?: string;
  /** 0 = synchronous, 1 = asynchronous. */
  mode?: number;
}

/** Currently-profiled steps: the profiler's "(Profiled)" clones. `contains` narrows server-side;
 * parseActiveProfiles re-checks the marker so a permissive server filter can't leak non-clones. */
export function activeProfilesQuery(): string {
  const expand = "$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode)";
  return `sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,mode,statecode&${expand}&$filter=statecode eq 0 and contains(name,'(Profiled)')&$top=200`;
}

/** Human label from a profiled clone's name: strip the "(Profiled)" suffix and, when the
 * name is the "Type: Message of entity" convention, keep the type part before the colon. Pure. */
export function profiledStepTypeLabel(name: string): string {
  const cleaned = (name ?? "").replace(PROFILED_MARKER, "").trim();
  const colon = cleaned.indexOf(":");
  return (colon > 0 ? cleaned.slice(0, colon) : cleaned).trim();
}

/** Shape the sdkmessageprocessingsteps response into active-profile rows (pure, unit-tested).
 * Keeps only rows still carrying the "(Profiled)" marker. */
export function parseActiveProfiles(body: any): ActiveProfileStep[] {
  const rows: any[] = body?.value ?? [];
  return rows
    .filter((row) => PROFILED_MARKER.test((row.name as string) ?? ""))
    .map((row) => ({
      profilerStepId: row.sdkmessageprocessingstepid as string,
      typeName: profiledStepTypeLabel((row.name as string) ?? ""),
      message: row.sdkmessageid?.name as string | undefined,
      primaryEntity: row.sdkmessagefilterid?.primaryobjecttypecode as string | undefined,
      mode: row.mode as number | undefined,
    }));
}

/** A step-attribute's identity, parsed from the source registration, used to match it to a
 * deployed server step (profilable original) or an active profiler clone (#139). */
export interface RegistrationKey {
  message?: string;
  primaryEntity?: string;
  /** Full type name (namespace.Class) or bare class name — matched leniently. */
  typeName?: string;
}

function norm(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function messageEntityMatch(step: { message?: string; primaryEntity?: string }, key: RegistrationKey): boolean {
  if (key.message && norm(step.message) !== norm(key.message)) {
    return false;
  }
  // An empty entity on either side matches (some messages have no primary entity).
  if (key.primaryEntity && step.primaryEntity && norm(step.primaryEntity) !== norm(key.primaryEntity)) {
    return false;
  }
  return true;
}

function typeMatch(stepType: string | undefined, keyType: string | undefined): boolean {
  if (!stepType || !keyType) {
    return false;
  }
  const a = norm(stepType);
  const b = norm(keyType);
  return a === b || a.endsWith(b) || b.endsWith(a) || a.includes(b) || b.includes(a);
}

/** Match a registration to a step by message + entity, disambiguating by type when several
 * share the same message/entity (pure, unit-tested). Undefined when nothing matches. */
export function findMatchingStep<T extends { message?: string; primaryEntity?: string; typeName?: string }>(steps: T[], key: RegistrationKey): T | undefined {
  const candidates = steps.filter((step) => messageEntityMatch(step, key));
  if (candidates.length <= 1) {
    return candidates[0];
  }
  const typed = candidates.filter((step) => typeMatch(step.typeName, key.typeName));
  return typed[0] ?? candidates[0];
}

/** Active profiler clones in the org, newest-agnostic. Undefined on failure/not connected. */
export async function getActiveProfiles(context: DataversePowerToolsContext): Promise<ActiveProfileStep[] | undefined> {
  const body = await getJson(context, "List active plugin profiles", activeProfilesQuery());
  return body ? parseActiveProfiles(body) : undefined;
}

/** Delete a profiler clone step via the Web API — the non-Windows fallback for "Stop"
 * (the net48 disable tool is Windows-only). Returns true on success. */
export async function deleteProfilerStep(context: DataversePowerToolsContext, profilerStepId: string): Promise<boolean> {
  if (!GUID.test(profilerStepId)) {
    return false;
  }
  const dataverse = context.dataverse;
  if (!dataverse || !canCallDataverseApi({ organizationUrl: dataverse.organizationUrl, isValid: dataverse.isValid })) {
    return false;
  }
  try {
    const url = dataverseApiUrl(dataverse.organizationUrl, `sdkmessageprocessingsteps(${profilerStepId})`);
    const response = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + (await dataverse.getAuthorizationToken()), "Content-Type": "application/json" },
    });
    if (!response.ok) {
      await logDataverseHttpError(context.channel, "delete the profiler step", response);
      return false;
    }
    return true;
  } catch (error) {
    logDataverseError(context.channel, "delete the profiler step", error);
    return false;
  }
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
