import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";
import { addDataverseSolutionComponent } from "./addDataverseSolutionComponent";
import { DataverseContext, Options } from "./dataverseContext";

export interface WorkflowActivityRegistration {
  className: string;
  fullTypeName: string;
  workflowName: string;
  workflowDescription?: string;
  workflowGroup?: string;
}

export interface RegisterWorkflowActivitiesResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

interface ExistingWorkflowSnapshot {
  name?: string;
  friendlyname?: string;
  description?: string;
  workflowactivitygroupname?: string;
}

interface ResolvedWorkflowPluginType {
  plugintypeid: string;
  snapshot: ExistingWorkflowSnapshot;
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizeString(value: string | undefined): string {
  return (value || "").trim();
}

async function ensureDataverseContext(context: DataversePowerToolsContext): Promise<boolean> {
  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
  }

  if (!context.dataverse.isValid) {
    return context.dataverse.initialize();
  }

  return true;
}

async function getJson(context: DataversePowerToolsContext, relativeUrl: string): Promise<any | undefined> {
  if (!(await ensureDataverseContext(context))) {
    return undefined;
  }

  const token = await context.dataverse.getAuthorizationToken();
  const baseUrl = context.dataverse.organizationUrl;
  if (!token || !baseUrl) {
    return undefined;
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  const response = await fetch(`${baseUrl}${relativeUrl}`, options);
  if (!response.ok) {
    context.channel.appendLine(await response.text());
    return undefined;
  }

  return response.json();
}

async function patchJson(context: DataversePowerToolsContext, relativeUrl: string, payload: any): Promise<boolean> {
  if (!(await ensureDataverseContext(context))) {
    return false;
  }

  const token = await context.dataverse.getAuthorizationToken();
  const baseUrl = context.dataverse.organizationUrl;
  if (!token || !baseUrl) {
    return false;
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  const response = await fetch(`${baseUrl}${relativeUrl}`, options);
  if (response.ok) {
    return true;
  }

  context.channel.appendLine(await response.text());
  return false;
}

async function resolveWorkflowPluginType(context: DataversePowerToolsContext, assemblyId: string, fullTypeName: string): Promise<ResolvedWorkflowPluginType | undefined> {
  const escapedTypeName = escapeODataString(fullTypeName);
  const data = await getJson(
    context,
    `/api/data/v9.1/plugintypes?$select=plugintypeid,typename,name,friendlyname,description,workflowactivitygroupname&$filter=_pluginassemblyid_value eq ${assemblyId} and typename eq '${escapedTypeName}'`,
  );

  const records = Array.isArray(data?.value) ? data.value : [];
  if (records.length === 0) {
    return undefined;
  }

  const record = records[0];
  const pluginTypeId = record?.plugintypeid as string | undefined;
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

function normalizeForCompare(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function toResolvedWorkflowPluginType(record: any): ResolvedWorkflowPluginType | undefined {
  const pluginTypeId = record?.plugintypeid as string | undefined;
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

async function resolveWorkflowPluginTypeFromAssembly(
  context: DataversePowerToolsContext,
  assemblyId: string,
  fullTypeName: string,
  className: string,
  workflowName: string,
): Promise<ResolvedWorkflowPluginType | undefined> {
  const data = await getJson(
    context,
    `/api/data/v9.1/plugintypes?$select=plugintypeid,typename,name,friendlyname,description,workflowactivitygroupname&$filter=_pluginassemblyid_value eq ${assemblyId}`,
  );

  const records: any[] = Array.isArray(data?.value) ? data.value : [];
  if (records.length === 0) {
    return undefined;
  }

  const normalizedFullTypeName = normalizeForCompare(fullTypeName);
  const normalizedClassName = normalizeForCompare(className);
  const normalizedWorkflowName = normalizeForCompare(workflowName);

  const exactType = records.find((record) => normalizeForCompare(record?.typename) === normalizedFullTypeName);
  if (exactType) {
    return toResolvedWorkflowPluginType(exactType);
  }

  const suffixType = records.find((record) => normalizeForCompare(record?.typename).endsWith(`.${normalizedClassName}`));
  if (suffixType) {
    return toResolvedWorkflowPluginType(suffixType);
  }

  const byName = records.find((record) => normalizeForCompare(record?.name) === normalizedWorkflowName || normalizeForCompare(record?.friendlyname) === normalizedWorkflowName);
  if (byName) {
    return toResolvedWorkflowPluginType(byName);
  }

  return undefined;
}

function getWorkflowPatchPayload(existing: ExistingWorkflowSnapshot, workflow: WorkflowActivityRegistration): any {
  const payload: any = {};

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

export async function registerWorkflowActivities(
  context: DataversePowerToolsContext,
  assemblyId: string,
  workflows: WorkflowActivityRegistration[],
  solutionUniqueName?: string,
): Promise<RegisterWorkflowActivitiesResult> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const workflow of workflows) {
    const workflowLabel = workflow.workflowName || workflow.className;
    const direct = await resolveWorkflowPluginType(context, assemblyId, workflow.fullTypeName);
    const resolved = direct || (await resolveWorkflowPluginTypeFromAssembly(context, assemblyId, workflow.fullTypeName, workflow.className, workflowLabel));
    if (!resolved) {
      context.channel.appendLine(`Skipping workflow activity '${workflowLabel}' because plugin type '${workflow.fullTypeName}' was not found in assembly.`);
      skipped++;
      continue;
    }

    const payload = getWorkflowPatchPayload(resolved.snapshot, workflow);
    if (Object.keys(payload).length > 0) {
      const patched = await patchJson(context, `/api/data/v9.1/plugintypes(${resolved.plugintypeid})`, payload);
      if (patched) {
        updated++;
        context.channel.appendLine(`Updated workflow activity '${workflowLabel}' (${workflow.className}).`);
      } else {
        context.channel.appendLine(`Skipping workflow activity '${workflowLabel}' because metadata update failed.`);
        skipped++;
        continue;
      }
    } else {
      unchanged++;
      context.channel.appendLine(`Workflow activity '${workflowLabel}' (${workflow.className}) is unchanged.`);
    }

    if (solutionUniqueName) {
      const associated = await addDataverseSolutionComponent(context, solutionUniqueName, 90, resolved.plugintypeid);
      if (!associated) {
        context.channel.appendLine(`Could not associate workflow activity '${workflowLabel}' with solution '${solutionUniqueName}'.`);
      } else {
        context.channel.appendLine(`Ensured workflow activity '${workflowLabel}' is associated with solution '${solutionUniqueName}'.`);
      }
    }
  }

  return { created, updated, unchanged, skipped };
}
