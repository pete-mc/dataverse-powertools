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
  patch(resourcePath: string, body: Record<string, unknown>): Promise<void>;
}

export interface StepSnapshot {
  sdkmessageprocessingstepid: string;
  name: string;
  configuration: string | null;
  /** _plugintypeid_value — the original event handler. */
  plugintypeid: string;
  /** The original plugin type's typename (for the config + restore sanity check). */
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

export function stepQuery(stepId: string): string {
  return `sdkmessageprocessingsteps(${stepId})?$select=sdkmessageprocessingstepid,name,configuration,_plugintypeid_value&$expand=plugintypeid($select=typename)`;
}

/** Rewire one step through the profiler. Returns the pre-change snapshot (the caller
 * MUST have persisted a backup of it before calling). */
export async function enableStepProfiling(client: WebApiClient, stepId: string, persistenceSessionKey: string): Promise<StepSnapshot> {
  const step = await client.get(stepQuery(stepId));
  const snapshot: StepSnapshot = {
    sdkmessageprocessingstepid: step.sdkmessageprocessingstepid,
    name: step.name,
    configuration: step.configuration ?? null,
    plugintypeid: step._plugintypeid_value,
    typename: step.plugintypeid?.typename ?? "",
  };
  if (parseProfilerConfiguration(snapshot.configuration)) {
    throw new Error("This step is already profiled — stop profiling first.");
  }
  const profilerTypes = await client.get(profilerPluginTypeQuery());
  const profilerTypeId = profilerTypes.value?.[0]?.plugintypeid;
  if (!profilerTypeId) {
    throw new Error("The Plugin Profiler solution is not installed in this environment.");
  }
  await client.patch(`sdkmessageprocessingsteps(${stepId})`, {
    "plugintypeid@odata.bind": `/plugintypes(${profilerTypeId})`,
    configuration: profilerConfigurationXml({
      originalPluginTypeId: snapshot.plugintypeid,
      originalTypeName: snapshot.typename,
      originalConfiguration: snapshot.configuration,
      persistenceSessionKey,
    }),
    name: `${snapshot.name}${PROFILED_NAME_SUFFIX}`,
  });
  return snapshot;
}

/** Restore a profiled step from its own carried configuration (PRT-compatible),
 * cross-checked against the persisted backup when supplied. */
export async function disableStepProfiling(client: WebApiClient, stepId: string, backup?: StepSnapshot): Promise<void> {
  const step = await client.get(stepQuery(stepId));
  const carried = parseProfilerConfiguration(step.configuration);
  const source = carried ?? (backup ? { originalPluginTypeId: backup.plugintypeid, originalTypeName: backup.typename, originalConfiguration: backup.configuration } : undefined);
  if (!source) {
    throw new Error("This step does not look profiled and no backup was found — nothing to restore.");
  }
  await client.patch(`sdkmessageprocessingsteps(${stepId})`, {
    "plugintypeid@odata.bind": `/plugintypes(${source.originalPluginTypeId})`,
    configuration: source.originalConfiguration,
    name: backup?.name ?? String(step.name ?? "").replace(PROFILED_NAME_SUFFIX, ""),
  });
}
