// Pure (vscode-free, HTTP-free) payload builders for registering an Azure Function as a
// Dataverse WEBHOOK (#145): a `serviceendpoint` record with contract = Webhook, plus an
// `sdkmessageprocessingstep` whose `eventhandler` points at it.
//
// Option-set values below are taken from the Microsoft Learn ServiceEndpoint table reference
// (serviceendpoint_contract / _authtype / _messageformat / _userclaim / _connectionmode) and
// "Register a WebHook":
//   https://learn.microsoft.com/power-apps/developer/data-platform/reference/entities/serviceendpoint
//   https://learn.microsoft.com/power-apps/developer/data-platform/register-web-hook
// The step's polymorphic `eventhandler` lookup binds through the navigation property
// `eventhandler_serviceendpoint` (SdkMessageProcessingStep many-to-one reference).

/** serviceendpoint.contract — 8 = Webhook (1 OneWay, 2 Queue, 3 Rest, 4 TwoWay, 5 Topic, …). */
export const SERVICE_ENDPOINT_CONTRACT_WEBHOOK = 8;

/** serviceendpoint.messageformat — 1 Binary XML, 2 Json, 3 Text XML. Webhooks POST JSON. */
export const SERVICE_ENDPOINT_MESSAGE_FORMAT_JSON = 2;

/** serviceendpoint.connectionmode — 1 Normal, 2 Federated. */
export const SERVICE_ENDPOINT_CONNECTION_MODE_NORMAL = 1;

/** serviceendpoint.authtype — the two modes that make sense for an Azure Function webhook. */
export enum WebhookAuthType {
  /** 4 = Webhook Key: the key is appended as the `code` query-string parameter (Functions host key). */
  webhookKey = 4,
  /** 5 = Http Header: the key is sent as an HTTP header (e.g. `x-functions-key`). */
  httpHeader = 5,
}

/** serviceendpoint.userclaim — 1 None, 2 UserId, 3 UserInfo. */
export enum WebhookUserClaim {
  none = 1,
  userId = 2,
  userInfo = 3,
}

/** sdkmessageprocessingstep.stage (the supported pipeline stages for a webhook step). */
export enum StepStage {
  preValidation = 10,
  preOperation = 20,
  postOperation = 40,
}

/** sdkmessageprocessingstep.mode — 0 synchronous, 1 asynchronous. */
export enum StepMode {
  synchronous = 0,
  asynchronous = 1,
}

export interface WebhookEndpointDefinition {
  /** serviceendpoint.name — also the key we look the endpoint up by. */
  name: string;
  /** The function's HTTPS endpoint. */
  url: string;
  authType: WebhookAuthType;
  /**
   * serviceendpoint.authvalue — the secret. For `webhookKey` this is the raw key (Dataverse
   * appends it as `?code=<key>`); for `httpHeader` it is `Header=Value` pairs, e.g.
   * `x-functions-key=<key>`. Write-only in Dataverse (never readable back).
   */
  authValue: string;
  userClaim?: WebhookUserClaim;
  description?: string;
}

export interface WebhookStepDefinition {
  /** sdkmessageprocessingstep.name. */
  stepName: string;
  /** SDK message (Create / Update / Delete / …). Resolved to an sdkmessageid by the caller. */
  messageName: string;
  /** Primary entity logical name; omit for a message with no primary entity. */
  entityLogicalName?: string;
  stage: StepStage;
  mode: StepMode;
  /** Comma-separated logical names (Update only). */
  filteringAttributes?: string;
  /** sdkmessageprocessingstep.rank (execution order). */
  executionOrder?: number;
  /** Async steps only: delete the AsyncOperation when it succeeds. */
  asyncAutoDelete?: boolean;
  description?: string;
}

/** True for a URL Dataverse will accept as a webhook endpoint (absolute https). */
export function isValidWebhookUrl(url: string): boolean {
  const trimmed = (url || "").trim();
  return /^https:\/\/[^\s]+$/i.test(trimmed);
}

/**
 * Build the `serviceendpoint` (Webhook) create/update payload. Every field but the identity
 * ones is a constant of "this is a JSON webhook": contract 8, messageformat 2, connectionmode 1.
 */
export function buildServiceEndpointPayload(definition: WebhookEndpointDefinition): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: definition.name,
    url: definition.url.trim(),
    contract: SERVICE_ENDPOINT_CONTRACT_WEBHOOK,
    messageformat: SERVICE_ENDPOINT_MESSAGE_FORMAT_JSON,
    connectionmode: SERVICE_ENDPOINT_CONNECTION_MODE_NORMAL,
    authtype: definition.authType,
    authvalue: definition.authValue,
    userclaim: definition.userClaim ?? WebhookUserClaim.none,
  };

  if (definition.description) {
    payload.description = definition.description;
  }

  return payload;
}

/**
 * Build the `sdkmessageprocessingstep` payload for a webhook step. The only structural
 * difference from a plugin step is the event handler: instead of `plugintypeid@odata.bind`
 * it binds the polymorphic `eventhandler` lookup through `eventhandler_serviceendpoint`.
 */
export function buildWebhookStepPayload(step: WebhookStepDefinition, serviceEndpointId: string, sdkMessageId: string, sdkMessageFilterId?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: step.stepName,
    rank: step.executionOrder ?? 1,
    stage: step.stage,
    mode: step.mode,
    supporteddeployment: 0,
    filteringattributes: step.filteringAttributes || "",
  };

  if (step.description) {
    payload.description = step.description;
  }

  if (step.mode === StepMode.asynchronous) {
    payload.asyncautodelete = step.asyncAutoDelete ?? true;
  }

  payload["eventhandler_serviceendpoint@odata.bind"] = `/serviceendpoints(${serviceEndpointId})`;
  payload["sdkmessageid@odata.bind"] = `/sdkmessages(${sdkMessageId})`;

  if (sdkMessageFilterId) {
    payload["sdkmessagefilterid@odata.bind"] = `/sdkmessagefilters(${sdkMessageFilterId})`;
  }

  return payload;
}

/** The auto-populated step name PRT would give this registration, e.g. "MyFn: Create of account". */
export function buildWebhookStepName(endpointName: string, messageName: string, entityLogicalName?: string): string {
  return entityLogicalName ? `${endpointName}: ${messageName} of ${entityLogicalName}` : `${endpointName}: ${messageName}`;
}

/**
 * The auth value to store on the endpoint for a given auth type. `webhookKey` sends the raw
 * key; `httpHeader` sends `<header>=<key>` (Azure Functions expects `x-functions-key`).
 */
export function buildAuthValue(authType: WebhookAuthType, key: string, headerName: string = "x-functions-key"): string {
  return authType === WebhookAuthType.httpHeader ? `${headerName}=${key}` : key;
}
