/* eslint-disable @typescript-eslint/naming-convention -- record fields are Dataverse logical names */
import DataversePowerToolsContext from "../../context";
import { dataverseApiUrl, logDataverseError, logDataverseHttpError, entityIdFromODataHeader } from "./webApi";
import { canCallDataverseApi } from "./connectionReady";
import { deleteProfilerStep } from "./pluginProfiles";

// Start/Stop Profiling a plug-in step, over the Web API (#264).
//
// This used to shell out to a net48, Windows-only console tool (profiler-tool/) because
// PRT's `ProfilerManagementUtility.EnablePlugin` takes a .NET-Framework `CrmServiceClient`.
// Decompiling that method showed it is nothing but ordinary SDK requests, so the whole
// feature is expressible here — which is what makes capture cross-platform.
//
// What "Start Profiling" actually is (the shape PRT implements, and the reason the
// README's old "raw Web-API step manipulation does not make the profiler fire" note was
// true — a naive clone misses every one of these):
//
//   1. CREATE a clone of the step whose `eventhandler` points at the PROFILER's plug-in
//      type instead of the user's, carrying stage/mode/rank/message/filter/deployment/
//      asyncautodelete/category across, and whose `configuration` is the profiler's own
//      serialized contract (see buildProfilerConfiguration).
//   2. MOVE the original step's images onto the clone — PRT re-parents them rather than
//      copying (it reads them with an empty ColumnSet, i.e. ids only, and re-attaches).
//      Without images the profiler captures a context missing its pre/post images.
//   3. RENAME the original to "<name> (Profiled)".
//   4. DISABLE the original — otherwise the real plug-in keeps firing directly and the
//      profiler has nothing to intercept.
//
// Stop Profiling reverses all four and deletes the clone. Both work under BOTH auth
// types — the access token authorises the call, so never gate on tenantId.

/** The profiler's own plug-in type + assembly (from the PluginProfiler managed solution). */
export const PROFILER_PLUGIN_TYPE_NAME = "PluginProfiler.Plugins.ProfilerPlugin";
export const PROFILER_PLUGIN_ASSEMBLY_NAME = "PluginProfiler.Plugins";

/** The description PRT stamps on the clone — kept identical so profiler steps look the same
 * whether this extension or the Plug-in Registration Tool created them. */
export const PROFILER_STEP_DESCRIPTION = "Plug-in profiler step that encapsulates the plug-in or provides the IPluginExecutionContext at a particular point in the pipeline.";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** sdkmessageprocessingstep statecode/statuscode. PRT uses SetState(state, -1) — "default
 * status for this state" — which the Web API doesn't accept, so the concrete pairs go here. */
export const STEP_STATE_ENABLED = { statecode: 0, statuscode: 1 };
export const STEP_STATE_DISABLED = { statecode: 1, statuscode: 2 };

export interface ProfilerConfigurationFields {
  assemblyId: string;
  typeName: string;
  /** The ORIGINAL step being profiled — the profiler reads this back to restore it. */
  stepId: string;
  originalEventHandlerName: string;
  maxNumberOfExecutions?: number;
  persistenceSessionKey?: string;
  includeSecureInformation?: boolean;
  isProfilePersistedToEntity?: boolean;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One EntityReference member, in the shape DataContractSerializer emits for
 * Microsoft.Xrm.Sdk.EntityReference (members alphabetical, absent ones nil). */
function entityReferenceXml(member: string, logicalName: string, id: string): string {
  return (
    `<${member} xmlns:a="http://schemas.microsoft.com/xrm/2011/Contracts">` +
    `<a:Id>${id}</a:Id>` +
    `<a:KeyAttributes xmlns:b="http://schemas.microsoft.com/xrm/7.1/Contracts" xmlns:c="http://schemas.datacontract.org/2004/07/System.Collections.Generic"/>` +
    `<a:LogicalName>${logicalName}</a:LogicalName>` +
    `<a:Name i:nil="true"/>` +
    `<a:RowVersion i:nil="true"/>` +
    `</${member}>`
  );
}

function nullableXml(member: string, value: string | undefined): string {
  return value === undefined ? `<${member} i:nil="true"/>` : `<${member}>${value}</${member}>`;
}

/**
 * The `sdkmessageprocessingstep.configuration` blob the profiler plug-in reads back
 * (pure, unit-tested against a real DataContractSerializer's output).
 *
 * This is `PluginProfiler.Plugins.ProfilerConfiguration`, declared
 * `[DataContract(Name = "Configuration", Namespace = "")]` with eleven `[DataMember]`s and
 * written by a plain `DataContractSerializer` — so members are emitted ALPHABETICALLY and
 * unset ones as `i:nil="true"`. Both of those matter: the server-side deserializer is the
 * profiler's own, and it is order-sensitive. Don't reorder these lines.
 */
export function buildProfilerConfiguration(fields: ProfilerConfigurationFields): string {
  return (
    `<Configuration xmlns:i="http://www.w3.org/2001/XMLSchema-instance">` +
    entityReferenceXml("AssemblyId", "pluginassembly", fields.assemblyId) +
    `<Configuration i:nil="true"/>` +
    entityReferenceXml("EventHandler", "sdkmessageprocessingstep", fields.stepId) +
    nullableXml("IncludeSecureInformation", fields.includeSecureInformation === undefined ? undefined : String(fields.includeSecureInformation)) +
    `<IsContextReplay i:nil="true"/>` +
    nullableXml("IsProfilePersistedToEntity", fields.isProfilePersistedToEntity === undefined ? undefined : String(fields.isProfilePersistedToEntity)) +
    nullableXml("MaxNumberOfExecutions", fields.maxNumberOfExecutions === undefined ? undefined : String(Math.floor(fields.maxNumberOfExecutions))) +
    `<OriginalEventHandlerName>${xmlEscape(fields.originalEventHandlerName)}</OriginalEventHandlerName>` +
    nullableXml("PersistenceSessionKey", fields.persistenceSessionKey) +
    `<TypeName>${xmlEscape(fields.typeName)}</TypeName>` +
    `<WorkflowStepId i:nil="true"/>` +
    `</Configuration>`
  );
}

export interface ParsedProfilerConfiguration {
  /** The ORIGINAL step's id (the profiler's `EventHandler` member). */
  stepId?: string;
  originalEventHandlerName?: string;
}

/**
 * Read back the two fields Stop Profiling needs from a `configuration` blob (pure,
 * unit-tested). Deliberately tolerant: the blob may have been written by the Plug-in
 * Registration Tool rather than by us, and only these two members are load-bearing.
 */
export function parseProfilerConfiguration(configuration: string | undefined): ParsedProfilerConfiguration {
  if (!configuration) {
    return {};
  }
  const eventHandler = /<EventHandler[^>]*>([\s\S]*?)<\/EventHandler>/.exec(configuration)?.[1];
  const stepId = eventHandler ? /<a:Id>([0-9a-f-]{36})<\/a:Id>/i.exec(eventHandler)?.[1] : undefined;
  const rawName = /<OriginalEventHandlerName[^>]*>([\s\S]*?)<\/OriginalEventHandlerName>/.exec(configuration)?.[1];
  const originalEventHandlerName = rawName?.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return { stepId, originalEventHandlerName: originalEventHandlerName || undefined };
}

// --- Pure query/payload builders -------------------------------------------------

export function profilerPluginTypeQuery(): string {
  return `plugintypes?$select=plugintypeid&$filter=typename eq '${PROFILER_PLUGIN_TYPE_NAME}' and pluginassemblyid/name eq '${PROFILER_PLUGIN_ASSEMBLY_NAME}'&$top=1`;
}

/** The original step, with every field the clone must carry across. */
export function stepToCloneQuery(stepId: string): string {
  const select = [
    "name",
    "stage",
    "mode",
    "rank",
    "supporteddeployment",
    "asyncautodelete",
    "category",
    "invocationsource",
    "statecode",
    "_sdkmessageid_value",
    "_sdkmessagefilterid_value",
    "_plugintypeid_value",
  ].join(",");
  return `sdkmessageprocessingsteps(${stepId})?$select=${select}&$expand=plugintypeid($select=typename,_pluginassemblyid_value)`;
}

export function stepImagesQuery(stepId: string): string {
  return `sdkmessageprocessingstepimages?$select=sdkmessageprocessingstepimageid&$filter=_sdkmessageprocessingstepid_value eq ${stepId}`;
}

export function profilerStepQuery(profilerStepId: string): string {
  return `sdkmessageprocessingsteps(${profilerStepId})?$select=name,configuration,statecode`;
}

/** The name the profiler gives its clone, and the one it renames the original to. */
export function profilerCloneName(originalName: string): string {
  return `${originalName} (Profiler)`;
}
export function profiledOriginalName(originalName: string): string {
  return `${originalName} (Profiled)`;
}

export interface StepClonePayloadInput {
  original: Record<string, any>;
  profilerPluginTypeId: string;
  configuration: string;
}

/**
 * The create body for the profiler's clone (pure, unit-tested). Everything here is copied
 * from the original except `eventhandler` (repointed at the profiler) and `configuration`.
 * A missing message FILTER is legitimate (some messages have no primary entity), so it is
 * bound only when present — binding null is a 400.
 */
export function buildProfilerStepPayload(input: StepClonePayloadInput): Record<string, unknown> {
  const { original, profilerPluginTypeId, configuration } = input;
  const payload: Record<string, unknown> = {
    name: profilerCloneName(String(original.name ?? "Unnamed plug-in")),
    description: PROFILER_STEP_DESCRIPTION,
    configuration,
    stage: original.stage,
    mode: original.mode,
    rank: original.rank,
    supporteddeployment: original.supporteddeployment,
    asyncautodelete: original.asyncautodelete,
    "eventhandler_plugintype@odata.bind": `/plugintypes(${profilerPluginTypeId})`,
    "sdkmessageid@odata.bind": `/sdkmessages(${original._sdkmessageid_value})`,
  };
  if (original._sdkmessagefilterid_value) {
    payload["sdkmessagefilterid@odata.bind"] = `/sdkmessagefilters(${original._sdkmessagefilterid_value})`;
  }
  if (original.category !== null && original.category !== undefined) {
    payload.category = original.category;
  }
  if (original.invocationsource !== null && original.invocationsource !== undefined) {
    payload.invocationsource = original.invocationsource;
  }
  return payload;
}

// --- Network -----------------------------------------------------------------------

export interface ProfilerStepResult {
  ok: boolean;
  profilerStepId?: string;
  error?: string;
}

interface Requester {
  get(operation: string, resource: string): Promise<any | undefined>;
  post(operation: string, resource: string, body: unknown): Promise<{ ok: boolean; id?: string }>;
  patch(operation: string, resource: string, body: unknown): Promise<boolean>;
}

function requester(context: DataversePowerToolsContext): Requester | undefined {
  const dataverse = context.dataverse;
  if (!dataverse || !canCallDataverseApi({ organizationUrl: dataverse.organizationUrl, isValid: dataverse.isValid })) {
    return undefined;
  }
  const send = async (method: string, operation: string, resource: string, body?: unknown): Promise<Response | undefined> => {
    const url = dataverseApiUrl(dataverse.organizationUrl, resource);
    const response = await fetch(url, {
      method,
      headers: { Authorization: "Bearer " + (await dataverse.getAuthorizationToken()), "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      await logDataverseHttpError(context.channel, operation, response);
      return undefined;
    }
    return response;
  };
  return {
    async get(operation, resource) {
      try {
        const response = await send("GET", operation, resource);
        return response ? await response.json() : undefined;
      } catch (error) {
        logDataverseError(context.channel, operation, error);
        return undefined;
      }
    },
    async post(operation, resource, body) {
      try {
        const response = await send("POST", operation, resource, body);
        return response ? { ok: true, id: entityIdFromODataHeader(response.headers.get("OData-EntityId")) } : { ok: false };
      } catch (error) {
        logDataverseError(context.channel, operation, error);
        return { ok: false };
      }
    },
    async patch(operation, resource, body) {
      try {
        return !!(await send("PATCH", operation, resource, body));
      } catch (error) {
        logDataverseError(context.channel, operation, error);
        return false;
      }
    },
  };
}

function newGuid(): string {
  const bytes = require("crypto").randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Re-parent a step's images onto another step. The profiler MOVES images rather than
 * copying them, so enable and disable are the same operation in opposite directions. */
async function moveImages(api: Requester, fromStepId: string, toStepId: string): Promise<void> {
  const body = await api.get("List the step's images", stepImagesQuery(fromStepId));
  for (const image of body?.value ?? []) {
    await api.patch("Move a step image to the profiler step", `sdkmessageprocessingstepimages(${image.sdkmessageprocessingstepimageid})`, {
      "sdkmessageprocessingstepid@odata.bind": `/sdkmessageprocessingsteps(${toStepId})`,
    });
  }
}

/**
 * Start Profiling `stepId`: register the profiler's clone, move the images across, then
 * rename and disable the original. Returns the CLONE's id — that is what Stop Profiling
 * takes, and what the panel's active-profiles list shows.
 *
 * On a partial failure the clone is deleted again, so a failed start never leaves the
 * user's step disabled with nothing profiling it.
 */
export async function enableStepProfiling(context: DataversePowerToolsContext, stepId: string, maxExecutions?: number): Promise<ProfilerStepResult> {
  if (!GUID.test(stepId)) {
    return { ok: false, error: `Not a plugin step id: ${stepId}` };
  }
  const api = requester(context);
  if (!api) {
    return { ok: false, error: "No valid Dataverse connection." };
  }

  const typeBody = await api.get("Find the Plugin Profiler's plug-in type", profilerPluginTypeQuery());
  const profilerPluginTypeId = typeBody?.value?.[0]?.plugintypeid as string | undefined;
  if (!profilerPluginTypeId) {
    return { ok: false, error: "The Plugin Profiler solution isn't installed in this environment." };
  }

  const original = await api.get("Read the plugin step to profile", stepToCloneQuery(stepId));
  if (!original?.name && original?.name !== "") {
    return { ok: false, error: "Could not read the plugin step to profile." };
  }
  if (original.statecode !== 0) {
    return { ok: false, error: "That step is disabled, so there is nothing to profile. It may already be profiled — stop profiling it first." };
  }

  const assemblyId = original.plugintypeid?._pluginassemblyid_value as string | undefined;
  const typeName = (original.plugintypeid?.typename as string) ?? "";
  if (!assemblyId) {
    return { ok: false, error: "Could not resolve the step's plug-in assembly." };
  }

  const configuration = buildProfilerConfiguration({
    assemblyId,
    typeName,
    stepId,
    originalEventHandlerName: String(original.name ?? "Unnamed plug-in"),
    maxNumberOfExecutions: maxExecutions,
    persistenceSessionKey: newGuid().replace(/-/g, ""),
    includeSecureInformation: false,
    isProfilePersistedToEntity: true,
  });

  const created = await api.post("Register the profiler step", "sdkmessageprocessingsteps", buildProfilerStepPayload({ original, profilerPluginTypeId, configuration }));
  if (!created.ok || !created.id) {
    return { ok: false, error: "Could not register the profiler step — see the output." };
  }
  const profilerStepId = created.id;

  await moveImages(api, stepId, profilerStepId);

  const renamed = await api.patch("Rename the profiled step", `sdkmessageprocessingsteps(${stepId})`, { name: profiledOriginalName(String(original.name ?? "")) });
  // Disabling the original is what makes the profiler fire instead of the real plug-in, so a
  // failure here is fatal to the capture — unwind rather than leave a clone that does nothing.
  const disabled = await api.patch("Disable the step being profiled", `sdkmessageprocessingsteps(${stepId})`, STEP_STATE_DISABLED);
  if (!disabled) {
    await moveImages(api, profilerStepId, stepId);
    if (renamed) {
      await api.patch("Restore the step name", `sdkmessageprocessingsteps(${stepId})`, { name: original.name });
    }
    await deleteProfilerStep(context, profilerStepId);
    return { ok: false, error: "Could not disable the step being profiled — see the output." };
  }

  return { ok: true, profilerStepId };
}

/**
 * Stop Profiling: move the images back, restore the original's name, re-enable it, and
 * delete the clone. Every step is best-effort EXCEPT the delete — a clone left behind keeps
 * the panel showing an active profile — and the original is re-enabled even if its blob is
 * unreadable, because leaving a user's step disabled is the worst outcome here.
 */
export async function disableStepProfiling(context: DataversePowerToolsContext, profilerStepId: string): Promise<ProfilerStepResult> {
  if (!GUID.test(profilerStepId)) {
    return { ok: false, error: `Not a profiler step id: ${profilerStepId}` };
  }
  const api = requester(context);
  if (!api) {
    return { ok: false, error: "No valid Dataverse connection." };
  }

  const clone = await api.get("Read the profiler step", profilerStepQuery(profilerStepId));
  const parsed = parseProfilerConfiguration(clone?.configuration as string | undefined);

  if (parsed.stepId) {
    await moveImages(api, profilerStepId, parsed.stepId);
    if (parsed.originalEventHandlerName) {
      await api.patch("Restore the profiled step's name", `sdkmessageprocessingsteps(${parsed.stepId})`, { name: parsed.originalEventHandlerName });
    }
    await api.patch("Re-enable the profiled step", `sdkmessageprocessingsteps(${parsed.stepId})`, STEP_STATE_ENABLED);
  } else {
    context.channel.appendLine(
      "[Profiler] The profiler step has no readable configuration, so the original step could not be identified — removing the profiler step only. If a step is left disabled, re-enable it in the Plug-in Registration Tool.",
    );
  }

  const deleted = await deleteProfilerStep(context, profilerStepId);
  return deleted ? { ok: true } : { ok: false, error: "Could not remove the profiler step — see the output." };
}
