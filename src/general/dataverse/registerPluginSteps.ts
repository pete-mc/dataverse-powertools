import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";
import { addDataverseSolutionComponent } from "./addDataverseSolutionComponent";
import { DataverseContext, Options } from "./dataverseContext";
import { dataverseApiUrl, entityIdFromODataHeader, logDataverseHttpError } from "./webApi";
import { escapeODataString } from "./odata";
import { PluginStepRegistration, ExistingStepSnapshot, buildStepPayload, stepNeedsUpdate } from "./stepPayloads";

export type { PluginStepRegistration } from "./stepPayloads";

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

  const response = await fetch(dataverseApiUrl(baseUrl, relativeUrl), options);
  if (!response.ok) {
    await logDataverseHttpError(context.channel, `GET ${relativeUrl}`, response);
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

  const response = await fetch(dataverseApiUrl(baseUrl, relativeUrl), options);
  if (!response.ok) {
    await logDataverseHttpError(context.channel, `${method} ${relativeUrl}`, response);
    return undefined;
  }

  if (method === "PATCH") {
    return {};
  }

  // A CREATE answers 204 No Content with the new id in the OData-EntityId header, so `.json()` here
  // threw "Unexpected end of JSON input" and failed the whole deploy the FIRST time a step was
  // registered (an existing step takes the PATCH path above, which is why only a first-time
  // registration ever hit it). Returning {} would be worse: the caller needs this id to add the new
  // step to the solution, so it would silently stop doing that.
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { ...body, id: entityIdFromODataHeader(response.headers.get("OData-EntityId")) };
}

async function resolvePluginTypeId(context: DataversePowerToolsContext, assemblyId: string, fullTypeName: string): Promise<string | undefined> {
  const escapedTypeName = escapeODataString(fullTypeName);
  const data = await getJson(context, `plugintypes?$select=plugintypeid,typename&$filter=_pluginassemblyid_value eq ${assemblyId} and typename eq '${escapedTypeName}'`);

  if (!data?.value || !Array.isArray(data.value) || data.value.length === 0) {
    return undefined;
  }

  return data.value[0]?.plugintypeid;
}

async function resolveSdkMessageId(context: DataversePowerToolsContext, messageName: string): Promise<string | undefined> {
  const escapedMessageName = escapeODataString(messageName);
  const data = await getJson(context, `sdkmessages?$select=sdkmessageid,name&$filter=name eq '${escapedMessageName}'`);
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
    `sdkmessagefilters?$select=sdkmessagefilterid,primaryobjecttypecode&$filter=_sdkmessageid_value eq ${sdkMessageId} and primaryobjecttypecode eq '${escapedEntityName}'`,
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
    `sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name&$filter=_plugintypeid_value eq ${pluginTypeId} and _sdkmessageid_value eq ${sdkMessageId} and name eq '${escapedStepName}'`,
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

  const response = await fetch(dataverseApiUrl(baseUrl, `sdkmessageprocessingsteps(${stepId})?$select=sdkmessageprocessingstepid`), options);
  if (response.ok) {
    return true;
  }

  if (response.status === 404) {
    return false;
  }

  await logDataverseHttpError(context.channel, `check plugin step '${stepId}'`, response);
  return false;
}

async function getExistingStepSnapshot(context: DataversePowerToolsContext, stepId: string): Promise<ExistingStepSnapshot | undefined> {
  const data = await getJson(context, `sdkmessageprocessingsteps(${stepId})?$select=sdkmessageprocessingstepid,name,rank,stage,mode,filteringattributes,_sdkmessagefilterid_value`);

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
        const updateResponse = await sendJson(context, "PATCH", `sdkmessageprocessingsteps(${existingStepId})`, stepPayload);
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

    const createResponse = await sendJson(context, "POST", "sdkmessageprocessingsteps", stepPayload);
    const createdStepId = createResponse?.id ?? createResponse?.sdkmessageprocessingstepid;
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
