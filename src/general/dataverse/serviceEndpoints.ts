import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";
import { DataverseContext, Options } from "./dataverseContext";
import { dataverseApiUrl, logDataverseHttpError } from "./webApi";
import { escapeODataString } from "./odata";
import { canCallDataverseApi } from "./connectionReady";
import { buildServiceEndpointPayload, buildWebhookStepPayload, WebhookEndpointDefinition, WebhookStepDefinition } from "../../azurefunction/webhookPayloads";

// Dataverse Web API calls for WEBHOOK registration (#145): the `serviceendpoint` (Webhook)
// record an Azure Function is exposed as, and the `sdkmessageprocessingstep` that fires it.
// Mirrors registerPluginSteps.ts. Gating is on the LIVE CONNECTION (canCallDataverseApi) and
// never on `tenantId` — interactive (OAuth) auth sets no tenant, and the access token is what
// authorizes the call (#90/#91).

async function ensureDataverseContext(context: DataversePowerToolsContext): Promise<boolean> {
  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
  }

  if (!context.dataverse.isValid) {
    await context.dataverse.initialize();
  }

  return canCallDataverseApi({ organizationUrl: context.dataverse.organizationUrl, isValid: context.dataverse.isValid });
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

async function sendJson(context: DataversePowerToolsContext, method: "POST" | "PATCH", relativeUrl: string, payload: unknown): Promise<any | undefined> {
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
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  const response = await fetch(dataverseApiUrl(baseUrl, relativeUrl), options);
  if (!response.ok) {
    await logDataverseHttpError(context.channel, `${method} ${relativeUrl}`, response);
    return undefined;
  }

  // A PATCH without a representation body returns 204 — treat that as success.
  if (response.status === 204) {
    return {};
  }

  try {
    return await response.json();
  } catch {
    return {};
  }
}

/** The serviceendpointid of an existing Webhook endpoint with this name, if any. */
export async function findWebhookServiceEndpointId(context: DataversePowerToolsContext, name: string): Promise<string | undefined> {
  const data = await getJson(context, `serviceendpoints?$select=serviceendpointid,name&$filter=name eq '${escapeODataString(name)}'`);
  if (!Array.isArray(data?.value) || data.value.length === 0) {
    return undefined;
  }
  return data.value[0]?.serviceendpointid;
}

export interface UpsertWebhookResult {
  serviceEndpointId?: string;
  created: boolean;
  updated: boolean;
}

/** Create the Webhook serviceendpoint, or update the existing one with the same name. */
export async function upsertWebhookServiceEndpoint(context: DataversePowerToolsContext, definition: WebhookEndpointDefinition): Promise<UpsertWebhookResult> {
  const payload = buildServiceEndpointPayload(definition);
  const existingId = await findWebhookServiceEndpointId(context, definition.name);

  if (existingId) {
    const updated = await sendJson(context, "PATCH", `serviceendpoints(${existingId})`, payload);
    if (updated === undefined) {
      return { created: false, updated: false };
    }
    context.channel.appendLine(`[Webhook] Updated service endpoint '${definition.name}' (${existingId}).`);
    return { serviceEndpointId: existingId, created: false, updated: true };
  }

  const created = await sendJson(context, "POST", "serviceendpoints", payload);
  const serviceEndpointId = created?.serviceendpointid;
  if (!serviceEndpointId) {
    return { created: false, updated: false };
  }
  context.channel.appendLine(`[Webhook] Created service endpoint '${definition.name}' (${serviceEndpointId}).`);
  return { serviceEndpointId, created: true, updated: false };
}

async function resolveSdkMessageId(context: DataversePowerToolsContext, messageName: string): Promise<string | undefined> {
  const data = await getJson(context, `sdkmessages?$select=sdkmessageid,name&$filter=name eq '${escapeODataString(messageName)}'`);
  if (!Array.isArray(data?.value) || data.value.length === 0) {
    return undefined;
  }
  return data.value[0]?.sdkmessageid;
}

async function resolveSdkMessageFilterId(context: DataversePowerToolsContext, sdkMessageId: string, entityLogicalName?: string): Promise<string | undefined> {
  if (!entityLogicalName) {
    return undefined;
  }

  const data = await getJson(
    context,
    `sdkmessagefilters?$select=sdkmessagefilterid,primaryobjecttypecode&$filter=_sdkmessageid_value eq ${sdkMessageId} and primaryobjecttypecode eq '${escapeODataString(entityLogicalName)}'`,
  );

  if (!Array.isArray(data?.value) || data.value.length === 0) {
    return undefined;
  }
  return data.value[0]?.sdkmessagefilterid;
}

/** An existing step with this name against this endpoint (so re-running the command updates). */
async function resolveExistingWebhookStepId(context: DataversePowerToolsContext, serviceEndpointId: string, stepName: string): Promise<string | undefined> {
  const data = await getJson(
    context,
    `sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name&$filter=_eventhandler_value eq ${serviceEndpointId} and name eq '${escapeODataString(stepName)}'`,
  );

  if (!Array.isArray(data?.value) || data.value.length === 0) {
    return undefined;
  }
  return data.value[0]?.sdkmessageprocessingstepid;
}

export interface RegisterWebhookStepResult {
  stepId?: string;
  created: boolean;
  updated: boolean;
  /** Why the registration didn't happen (message/filter not found, or the write failed). */
  error?: string;
}

/** Create/update the sdkmessageprocessingstep that fires the webhook endpoint. */
export async function registerWebhookStep(context: DataversePowerToolsContext, serviceEndpointId: string, step: WebhookStepDefinition): Promise<RegisterWebhookStepResult> {
  const sdkMessageId = await resolveSdkMessageId(context, step.messageName);
  if (!sdkMessageId) {
    return { created: false, updated: false, error: `Message '${step.messageName}' was not found in this environment.` };
  }

  const sdkMessageFilterId = await resolveSdkMessageFilterId(context, sdkMessageId, step.entityLogicalName);
  if (step.entityLogicalName && !sdkMessageFilterId) {
    return { created: false, updated: false, error: `Message '${step.messageName}' is not available for table '${step.entityLogicalName}'.` };
  }

  const payload = buildWebhookStepPayload(step, serviceEndpointId, sdkMessageId, sdkMessageFilterId);
  const existingStepId = await resolveExistingWebhookStepId(context, serviceEndpointId, step.stepName);

  if (existingStepId) {
    const updated = await sendJson(context, "PATCH", `sdkmessageprocessingsteps(${existingStepId})`, payload);
    if (updated === undefined) {
      return { created: false, updated: false, error: `Could not update step '${step.stepName}'.` };
    }
    return { stepId: existingStepId, created: false, updated: true };
  }

  const created = await sendJson(context, "POST", "sdkmessageprocessingsteps", payload);
  const stepId = created?.sdkmessageprocessingstepid;
  if (!stepId) {
    return { created: false, updated: false, error: `Could not create step '${step.stepName}'.` };
  }
  return { stepId, created: true, updated: false };
}
