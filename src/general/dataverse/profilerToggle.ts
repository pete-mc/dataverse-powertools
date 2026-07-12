/* eslint-disable @typescript-eslint/naming-convention -- Dataverse logical names + DataContract XML */
// Toggle profiling on a plug-in step (#63 phase 2b) — the way the Plugin
// Registration Tool does it, replicated over the Web API: the step is rewired
// IN PLACE to the profiler's ProfilerPlugin type, and its unsecure
// configuration becomes a DataContract-serialized ProfilerConfiguration that
// CARRIES the original identity (plugintype reference + original unsecure
// config + type name) — which is also exactly what stop-profiling restores.
// The XML template below was produced by serializing a real
// PluginProfiler.Plugins.ProfilerConfiguration with DataContractSerializer,
// not written by hand: element order and namespaces must match byte-for-byte
// or the profiler plugin cannot read its own settings.
//
// Functions take a minimal WebApiClient so the live test drives the SAME code
// the extension runs (the extension supplies a fetch/token client).

export const PROFILER_PLUGIN_TYPE_NAME = "PluginProfiler.Plugins.ProfilerPlugin";
export const PROFILED_NAME_SUFFIX = " (Profiled by DVPT)";

export interface WebApiClient {
  get(resourcePath: string): Promise<any>;
  /** POST; returns the created record's id (from OData-EntityId). */
  post(resourcePath: string, body: Record<string, unknown>): Promise<string | undefined>;
  patch(resourcePath: string, body: Record<string, unknown>): Promise<void>;
  del(resourcePath: string): Promise<void>;
}

/** What profiling one step produced — enough to reverse it exactly. Profiling
 * follows the PRT model: CREATE a separate "(Profiled)" step routed through the
 * ProfilerPlugin, and DISABLE the original (the in-place rewire the 0.8.0 code
 * used never actually captured). Restore = delete the profiler step + re-enable
 * the original. */
export interface StepSnapshot {
  /** The original step (now disabled) to re-enable on restore. */
  originalStepId: string;
  /** The created profiler step to delete on restore. */
  profilerStepId: string;
  /** Original step name (display / restore-name). */
  name: string;
  /** Original plugin type's typename (CodeLens scope + display). */
  typename: string;
}

/** Executions the profiler captures before it auto-stops. The PRT's default is a
 * finite positive number; a nil/zero value persists NOTHING (the shipped 0.8.0
 * config left this nil, so captures never landed). */
export const DEFAULT_MAX_PROFILED_EXECUTIONS = 100;

/** The exact unsecure-configuration XML the ProfilerPlugin deserializes. */
export function profilerConfigurationXml(options: {
  originalPluginTypeId: string;
  originalTypeName: string;
  originalConfiguration: string | null;
  persistenceSessionKey: string;
  maxNumberOfExecutions?: number;
}): string {
  const original = options.originalConfiguration;
  const configurationElement = original === null || original === undefined ? `<Configuration i:nil="true" />` : `<Configuration>${escapeXml(original)}</Configuration>`;
  const maxExecutions = options.maxNumberOfExecutions ?? DEFAULT_MAX_PROFILED_EXECUTIONS;
  return (
    `<Configuration xmlns:i="http://www.w3.org/2001/XMLSchema-instance">` +
    `<AssemblyId xmlns:d2p1="http://schemas.microsoft.com/xrm/2011/Contracts" i:nil="true" />` +
    configurationElement +
    `<EventHandler xmlns:d2p1="http://schemas.microsoft.com/xrm/2011/Contracts">` +
    `<d2p1:Id>${options.originalPluginTypeId}</d2p1:Id>` +
    `<d2p1:KeyAttributes xmlns:d3p1="http://schemas.microsoft.com/xrm/7.1/Contracts" xmlns:d3p2="http://schemas.datacontract.org/2004/07/System.Collections.Generic" />` +
    `<d2p1:LogicalName>plugintype</d2p1:LogicalName>` +
    `<d2p1:Name i:nil="true" />` +
    `<d2p1:RowVersion i:nil="true" />` +
    `</EventHandler>` +
    `<IncludeSecureInformation>false</IncludeSecureInformation>` +
    `<IsContextReplay i:nil="true" />` +
    `<IsProfilePersistedToEntity>true</IsProfilePersistedToEntity>` +
    `<MaxNumberOfExecutions>${maxExecutions}</MaxNumberOfExecutions>` +
    `<OriginalEventHandlerName>${escapeXml(options.originalTypeName)}</OriginalEventHandlerName>` +
    `<PersistenceSessionKey>${escapeXml(options.persistenceSessionKey)}</PersistenceSessionKey>` +
    `<TypeName>${escapeXml(options.originalTypeName)}</TypeName>` +
    `<WorkflowStepId i:nil="true" />` +
    `</Configuration>`
  );
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Whether a step's configuration is our profiler rewire; extracts the restore info. Pure. */
export function parseProfilerConfiguration(
  configuration: string | null | undefined,
): { originalPluginTypeId: string; originalTypeName: string; originalConfiguration: string | null } | undefined {
  if (!configuration || !configuration.includes("<OriginalEventHandlerName>")) {
    return undefined;
  }
  const id = configuration.match(/<d2p1:Id>([0-9a-f-]{36})<\/d2p1:Id>/i)?.[1];
  const typeName = configuration.match(/<OriginalEventHandlerName>([^<]*)<\/OriginalEventHandlerName>/)?.[1];
  if (!id || !typeName) {
    return undefined;
  }
  const nilConfig = /<Configuration i:nil="true" \/><EventHandler/.test(configuration);
  const original = nilConfig ? null : (configuration.match(/<Configuration>([\s\S]*?)<\/Configuration><EventHandler/)?.[1] ?? null);
  return { originalPluginTypeId: id, originalTypeName: typeName, originalConfiguration: original === null ? null : unescapeXml(original) };
}

function unescapeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** The registered steps for a set of plugin types (by typename prefix match on the
 * project's assembly), with what the toggle needs. */
export function stepsForAssemblyQuery(assemblyName: string): string {
  const escaped = assemblyName.replace(/'/g, "''");
  return (
    `sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,configuration,_plugintypeid_value,statecode` +
    `&$expand=plugintypeid($select=typename;$expand=pluginassemblyid($select=name))` +
    `&$filter=plugintypeid/pluginassemblyid/name eq '${escaped}'`
  );
}

export function profilerPluginTypeQuery(): string {
  return `plugintypes?$select=plugintypeid&$filter=typename eq '${PROFILER_PLUGIN_TYPE_NAME}'`;
}

/** All fields we copy from the original step onto the profiler step. */
export function fullStepQuery(stepId: string): string {
  return (
    `sdkmessageprocessingsteps(${stepId})?$select=sdkmessageprocessingstepid,name,configuration,stage,mode,rank,supporteddeployment,statecode,` +
    `asyncautodelete,filteringattributes,_plugintypeid_value,_sdkmessageid_value,_sdkmessagefilterid_value&$expand=plugintypeid($select=typename)`
  );
}

export function stepImagesQuery(stepId: string): string {
  return `sdkmessageprocessingstepimages?$select=name,entityalias,imagetype,attributes,messagepropertyname&$filter=_sdkmessageprocessingstepid_value eq ${stepId}`;
}

/** Enable profiling on a step — the PRT way: CREATE a profiler step (a copy of
 * the original routed through the ProfilerPlugin, carrying the original identity
 * + persist config, with the images copied) and DISABLE the original. Returns
 * the snapshot the caller MUST have persisted a backup of before calling. */
export async function enableStepProfiling(client: WebApiClient, stepId: string, persistenceSessionKey: string): Promise<StepSnapshot> {
  const step = await client.get(fullStepQuery(stepId));
  const typename = step.plugintypeid?.typename ?? "";
  if (typename === PROFILER_PLUGIN_TYPE_NAME || String(step.name ?? "").endsWith(PROFILED_NAME_SUFFIX)) {
    throw new Error("This step is already a profiler step.");
  }
  const profilerTypeId = (await client.get(profilerPluginTypeQuery())).value?.[0]?.plugintypeid;
  if (!profilerTypeId) {
    throw new Error("The Plugin Profiler solution is not installed in this environment.");
  }

  // Create the profiler step: same message/filter/stage/mode/rank as the original,
  // but bound to the ProfilerPlugin type and carrying the persist config.
  const body: Record<string, unknown> = {
    name: `${step.name}${PROFILED_NAME_SUFFIX}`,
    stage: step.stage,
    mode: step.mode,
    rank: step.rank,
    supporteddeployment: step.supporteddeployment,
    configuration: profilerConfigurationXml({
      originalPluginTypeId: step._plugintypeid_value,
      originalTypeName: typename,
      originalConfiguration: step.configuration ?? null,
      persistenceSessionKey,
    }),
    "plugintypeid@odata.bind": `/plugintypes(${profilerTypeId})`,
    "sdkmessageid@odata.bind": `/sdkmessages(${step._sdkmessageid_value})`,
  };
  if (step._sdkmessagefilterid_value) {
    body["sdkmessagefilterid@odata.bind"] = `/sdkmessagefilters(${step._sdkmessagefilterid_value})`;
  }
  if (step.filteringattributes) {
    body.filteringattributes = step.filteringattributes;
  }
  if (typeof step.asyncautodelete === "boolean") {
    body.asyncautodelete = step.asyncautodelete;
  }
  const profilerStepId = await client.post("sdkmessageprocessingsteps", body);
  if (!profilerStepId) {
    throw new Error("Failed to create the profiler step.");
  }

  // Ensure the profiler step is ENABLED — a new step can default to disabled, in
  // which case it never fires and no capture is persisted (PRT sets statecode
  // explicitly). Best-effort: some orgs reject statecode on create, so PATCH it.
  try {
    await client.patch(`sdkmessageprocessingsteps(${profilerStepId})`, { statecode: 0, statuscode: 1 });
  } catch {
    /* already enabled */
  }

  // From here the create must fully succeed or fully roll back — a half-done
  // enable (profiler step created but original still enabled) would double-fire.
  try {
    // Copy the original's images onto the profiler step (pre/post images the plugin reads).
    const images = (await client.get(stepImagesQuery(stepId))).value ?? [];
    for (const image of images) {
      await client.post("sdkmessageprocessingstepimages", {
        name: image.name,
        entityalias: image.entityalias,
        imagetype: image.imagetype,
        attributes: image.attributes,
        messagepropertyname: image.messagepropertyname,
        "sdkmessageprocessingstepid@odata.bind": `/sdkmessageprocessingsteps(${profilerStepId})`,
      });
    }
    // Disable the original so only the profiler step fires.
    await client.patch(`sdkmessageprocessingsteps(${stepId})`, { statecode: 1, statuscode: 2 });
  } catch (error) {
    await client.del(`sdkmessageprocessingsteps(${profilerStepId})`).catch(() => undefined);
    throw error;
  }
  return { originalStepId: stepId, profilerStepId, name: step.name, typename };
}

/** Reverse profiling: delete the profiler step, re-enable the original. */
export async function disableStepProfiling(client: WebApiClient, snapshot: StepSnapshot): Promise<void> {
  if (snapshot.profilerStepId) {
    await client.del(`sdkmessageprocessingsteps(${snapshot.profilerStepId})`);
  }
  await client.patch(`sdkmessageprocessingsteps(${snapshot.originalStepId})`, { statecode: 0, statuscode: 1 });
}
