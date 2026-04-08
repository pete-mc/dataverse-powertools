import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";
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
    const stepData = await getJson(context, `/api/data/v9.1/sdkmessageprocessingsteps(${step.stepId})?$select=sdkmessageprocessingstepid`);
    if (stepData?.sdkmessageprocessingstepid) {
      return stepData.sdkmessageprocessingstepid;
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
  skipped: number;
}

export async function registerPluginSteps(context: DataversePowerToolsContext, assemblyId: string, steps: PluginStepRegistration[]): Promise<RegisterPluginStepsResult> {
  let created = 0;
  let updated = 0;
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
      const updateResponse = await sendJson(context, "PATCH", `/api/data/v9.1/sdkmessageprocessingsteps(${existingStepId})`, stepPayload);
      if (updateResponse !== undefined) {
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    const createResponse = await sendJson(context, "POST", "/api/data/v9.1/sdkmessageprocessingsteps", stepPayload);
    if (createResponse !== undefined) {
      created++;
    } else {
      skipped++;
    }
  }

  return { created, updated, skipped };
}
