import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";
import { addDataverseSolutionComponent } from "./addDataverseSolutionComponent";
import { DataverseContext, Options } from "./dataverseContext";

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

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
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

async function sendJson(context: DataversePowerToolsContext, method: "POST" | "PATCH", relativeUrl: string, payload: any): Promise<any | undefined> {
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
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  const response = await fetch(`${baseUrl}${relativeUrl}`, options);
  if (!response.ok) {
    context.channel.appendLine(await response.text());
    return undefined;
  }

  if (method === "PATCH") {
    return {};
  }

  return response.json();
}

async function resolvePluginTypeId(context: DataversePowerToolsContext, assemblyId: string, fullTypeName: string): Promise<string | undefined> {
  const escapedTypeName = escapeODataString(fullTypeName);
  const data = await getJson(
    context,
    `/api/data/v9.1/plugintypes?$select=plugintypeid,typename&$filter=_pluginassemblyid_value eq ${assemblyId} and typename eq '${escapedTypeName}'`,
  );

  if (!data?.value || !Array.isArray(data.value) || data.value.length === 0) {
    return undefined;
  }

  return data.value[0]?.plugintypeid;
}

async function resolveSdkMessageId(context: DataversePowerToolsContext, messageName: string): Promise<string | undefined> {
  const escapedMessageName = escapeODataString(messageName);
  const data = await getJson(context, `/api/data/v9.1/sdkmessages?$select=sdkmessageid,name&$filter=name eq '${escapedMessageName}'`);
  if (!data?.value || !Array.isArray(data.value) || data.value.length === 0) {
    return undefined;
  }

  return data.value[0]?.sdkmessageid;
}

async function resolveSdkMessageFilterId(context: DataversePowerToolsContext, sdkMessageId: string, entityLogicalName?: string): Promise<string | undefined> {
  if (!entityLogicalName) {
    return undefined;
  }

  const escapedEntityName = escapeODataString(entityLogicalName);
  const data = await getJson(
    context,
    `/api/data/v9.1/sdkmessagefilters?$select=sdkmessagefilterid,primaryobjecttypecode&$filter=_sdkmessageid_value eq ${sdkMessageId} and primaryobjecttypecode eq '${escapedEntityName}'`,
  );

  if (!data?.value || !Array.isArray(data.value) || data.value.length === 0) {
    return undefined;
  }

  return data.value[0]?.sdkmessagefilterid;
}

async function resolveExistingStepId(context: DataversePowerToolsContext, step: PluginStepRegistration, pluginTypeId: string, sdkMessageId: string): Promise<string | undefined> {
  if (step.stepId) {
    const explicitIdExists = await doesStepExistById(context, step.stepId);
    if (explicitIdExists) {
      return step.stepId;
    }
  }

  const escapedStepName = escapeODataString(step.stepName);
  const data = await getJson(
    context,
    `/api/data/v9.1/sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name&$filter=_plugintypeid_value eq ${pluginTypeId} and _sdkmessageid_value eq ${sdkMessageId} and name eq '${escapedStepName}'`,
  );

  if (!data?.value || !Array.isArray(data.value) || data.value.length === 0) {
    return undefined;
  }

  return data.value[0]?.sdkmessageprocessingstepid;
}

async function doesStepExistById(context: DataversePowerToolsContext, stepId: string): Promise<boolean> {
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
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  const response = await fetch(`${baseUrl}/api/data/v9.1/sdkmessageprocessingsteps(${stepId})?$select=sdkmessageprocessingstepid`, options);
  if (response.ok) {
    return true;
  }

  if (response.status === 404) {
    return false;
  }

  context.channel.appendLine(await response.text());
  return false;
}

interface ExistingStepSnapshot {
  sdkmessageprocessingstepid?: string;
  name?: string;
  rank?: number;
  stage?: number;
  mode?: number;
  filteringattributes?: string;
  sdkMessageFilterId?: string;
}

async function getExistingStepSnapshot(context: DataversePowerToolsContext, stepId: string): Promise<ExistingStepSnapshot | undefined> {
  const data = await getJson(
    context,
    `/api/data/v9.1/sdkmessageprocessingsteps(${stepId})?$select=sdkmessageprocessingstepid,name,rank,stage,mode,filteringattributes,_sdkmessagefilterid_value`,
  );

  if (!data) {
    return undefined;
  }

  return {
    sdkmessageprocessingstepid: data.sdkmessageprocessingstepid,
    name: data.name,
    rank: data.rank,
    stage: data.stage,
    mode: data.mode,
    filteringattributes: data.filteringattributes,
    sdkMessageFilterId: data._sdkmessagefilterid_value,
  };
}

function normalizeFilteringAttributes(value: string | undefined): string {
  const normalized = (value || "")
    .split(",")
    .map((attribute) => attribute.trim().toLowerCase())
    .filter((attribute) => attribute.length > 0)
    .sort((a, b) => a.localeCompare(b));

  return normalized.join(",");
}

function stepNeedsUpdate(existingStep: ExistingStepSnapshot, step: PluginStepRegistration, sdkMessageFilterId?: string): boolean {
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

function buildStepPayload(step: PluginStepRegistration, pluginTypeId: string, sdkMessageId: string, sdkMessageFilterId?: string): any {
  const payload: any = {
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

export interface RegisterPluginStepsResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

export async function registerPluginSteps(
  context: DataversePowerToolsContext,
  assemblyId: string,
  steps: PluginStepRegistration[],
  solutionUniqueName?: string,
): Promise<RegisterPluginStepsResult> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const step of steps) {
    const pluginTypeId = await resolvePluginTypeId(context, assemblyId, step.fullTypeName);
    if (!pluginTypeId) {
      context.channel.appendLine(`Skipping step '${step.stepName}' because plugin type '${step.fullTypeName}' was not found in assembly.`);
      skipped++;
      continue;
    }

    const sdkMessageId = await resolveSdkMessageId(context, step.messageName);
    if (!sdkMessageId) {
      context.channel.appendLine(`Skipping step '${step.stepName}' because message '${step.messageName}' was not found.`);
      skipped++;
      continue;
    }

    const sdkMessageFilterId = await resolveSdkMessageFilterId(context, sdkMessageId, step.entityLogicalName);
    if (step.entityLogicalName && !sdkMessageFilterId) {
      context.channel.appendLine(`Skipping step '${step.stepName}' because message filter for '${step.messageName}' + '${step.entityLogicalName}' was not found.`);
      skipped++;
      continue;
    }

    const stepPayload = buildStepPayload(step, pluginTypeId, sdkMessageId, sdkMessageFilterId);
    const existingStepId = await resolveExistingStepId(context, step, pluginTypeId, sdkMessageId);
    if (existingStepId) {
      const existingSnapshot = await getExistingStepSnapshot(context, existingStepId);
      const requiresUpdate = existingSnapshot ? stepNeedsUpdate(existingSnapshot, step, sdkMessageFilterId) : true;

      if (requiresUpdate) {
        const updateResponse = await sendJson(context, "PATCH", `/api/data/v9.1/sdkmessageprocessingsteps(${existingStepId})`, stepPayload);
        if (updateResponse !== undefined) {
          updated++;
        } else {
          skipped++;
          continue;
        }
      } else {
        unchanged++;
      }

      if (solutionUniqueName) {
        const associated = await addDataverseSolutionComponent(context, solutionUniqueName, 92, existingStepId);
        if (!associated) {
          context.channel.appendLine(`Could not associate step '${step.stepName}' with solution '${solutionUniqueName}'.`);
        }
      }

      continue;
    }

    const createResponse = await sendJson(context, "POST", "/api/data/v9.1/sdkmessageprocessingsteps", stepPayload);
    const createdStepId = createResponse?.sdkmessageprocessingstepid;
    if (createResponse !== undefined && createdStepId) {
      created++;

      if (solutionUniqueName) {
        const associated = await addDataverseSolutionComponent(context, solutionUniqueName, 92, createdStepId);
        if (!associated) {
          context.channel.appendLine(`Could not associate step '${step.stepName}' with solution '${solutionUniqueName}'.`);
        }
      }
    } else {
      skipped++;
    }
  }

  return { created, updated, unchanged, skipped };
}
