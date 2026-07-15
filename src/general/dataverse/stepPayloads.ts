// Pure, vscode/network-free builders for plugin-step and workflow-activity
// registration payloads and change-detection. Extracted from
// registerPluginSteps.ts / registerWorkflowActivities.ts so the OData
// `@odata.bind` payload shapes and the "does this need an update" diffing can be
// unit-tested in isolation (#143 Move 3). The network files import from here.

// ─── Plugin steps ────────────────────────────────────────────────────────────

export interface PluginStepRegistration {
  className: string;
  fullTypeName: string;
  messageName: string;
  entityLogicalName?: string;
  stage: number;
  mode: number;
  filteringAttributes?: string;
  stepName: string;
  executionOrder: number;
  stepId?: string;
}

export interface ExistingStepSnapshot {
  sdkmessageprocessingstepid?: string;
  name?: string;
  rank?: number;
  stage?: number;
  mode?: number;
  filteringattributes?: string;
  sdkMessageFilterId?: string;
}

/** Canonicalise a comma-separated filtering-attributes list so two equivalent
 * lists compare equal: trim, lower-case, drop empties, sort. */
export function normalizeFilteringAttributes(value: string | undefined): string {
  const normalized = (value || "")
    .split(",")
    .map((attribute) => attribute.trim().toLowerCase())
    .filter((attribute) => attribute.length > 0)
    .sort((a, b) => a.localeCompare(b));

  return normalized.join(",");
}

/** True when the live step differs from what we want to register (so we PATCH). */
export function stepNeedsUpdate(existingStep: ExistingStepSnapshot, step: PluginStepRegistration, sdkMessageFilterId?: string): boolean {
  const existingFilter = normalizeFilteringAttributes(existingStep.filteringattributes);
  const requestedFilter = normalizeFilteringAttributes(step.filteringAttributes);
  const existingMessageFilterId = existingStep.sdkMessageFilterId || undefined;
  const requestedMessageFilterId = sdkMessageFilterId || undefined;

  if ((existingStep.name || "") !== step.stepName) {
    return true;
  }

  if ((existingStep.rank ?? 0) !== step.executionOrder) {
    return true;
  }

  if ((existingStep.stage ?? 0) !== step.stage) {
    return true;
  }

  if ((existingStep.mode ?? 0) !== step.mode) {
    return true;
  }

  if (existingFilter !== requestedFilter) {
    return true;
  }

  if ((existingMessageFilterId || "") !== (requestedMessageFilterId || "")) {
    return true;
  }

  return false;
}

/** Build the create/update body for an `sdkmessageprocessingstep`, including the
 * `@odata.bind` navigation properties Dataverse requires. */
export function buildStepPayload(step: PluginStepRegistration, pluginTypeId: string, sdkMessageId: string, sdkMessageFilterId?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: step.stepName,
    rank: step.executionOrder,
    stage: step.stage,
    mode: step.mode,
    supporteddeployment: 0,
    filteringattributes: step.filteringAttributes || "",
  };

  payload["plugintypeid@odata.bind"] = `/plugintypes(${pluginTypeId})`;
  payload["sdkmessageid@odata.bind"] = `/sdkmessages(${sdkMessageId})`;

  if (sdkMessageFilterId) {
    payload["sdkmessagefilterid@odata.bind"] = `/sdkmessagefilters(${sdkMessageFilterId})`;
  }

  return payload;
}

// ─── Workflow activities ─────────────────────────────────────────────────────

export interface WorkflowActivityRegistration {
  className: string;
  fullTypeName: string;
  workflowName: string;
  workflowDescription?: string;
  workflowGroup?: string;
}

export interface ExistingWorkflowSnapshot {
  name?: string;
  friendlyname?: string;
  description?: string;
  workflowactivitygroupname?: string;
}

export interface ResolvedWorkflowPluginType {
  plugintypeid: string;
  snapshot: ExistingWorkflowSnapshot;
}

export function normalizeString(value: string | undefined): string {
  return (value || "").trim();
}

export function normalizeForCompare(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

/** Shape a `plugintypes` record into the id + snapshot we diff against; undefined
 * when the record has no plugintypeid. */
export function toResolvedWorkflowPluginType(
  record: { plugintypeid?: string; name?: string; friendlyname?: string; description?: string; workflowactivitygroupname?: string } | undefined | null,
): ResolvedWorkflowPluginType | undefined {
  const pluginTypeId = record?.plugintypeid;
  if (!pluginTypeId) {
    return undefined;
  }

  return {
    plugintypeid: pluginTypeId,
    snapshot: {
      name: record?.name,
      friendlyname: record?.friendlyname,
      description: record?.description,
      workflowactivitygroupname: record?.workflowactivitygroupname,
    },
  };
}

/** Build a sparse PATCH body for a workflow-activity `plugintype`: only the
 * fields that actually differ from the live record are included (empty object =
 * no change). */
export function getWorkflowPatchPayload(existing: ExistingWorkflowSnapshot, workflow: WorkflowActivityRegistration): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  const requestedName = normalizeString(workflow.workflowName) || workflow.className;
  const requestedDescription = normalizeString(workflow.workflowDescription);
  const requestedGroup = normalizeString(workflow.workflowGroup);

  if (normalizeString(existing.name) !== requestedName) {
    payload.name = requestedName;
  }

  if (normalizeString(existing.friendlyname) !== requestedName) {
    payload.friendlyname = requestedName;
  }

  if (normalizeString(existing.description) !== requestedDescription) {
    payload.description = requestedDescription;
  }

  if (normalizeString(existing.workflowactivitygroupname) !== requestedGroup) {
    payload.workflowactivitygroupname = requestedGroup;
  }

  return payload;
}
