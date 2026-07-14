import { describe, it, expect } from "vitest";
import {
  buildAuthValue,
  buildServiceEndpointPayload,
  buildWebhookStepName,
  buildWebhookStepPayload,
  isValidWebhookUrl,
  SERVICE_ENDPOINT_CONNECTION_MODE_NORMAL,
  SERVICE_ENDPOINT_CONTRACT_WEBHOOK,
  SERVICE_ENDPOINT_MESSAGE_FORMAT_JSON,
  StepMode,
  StepStage,
  WebhookAuthType,
  WebhookUserClaim,
} from "./webhookPayloads";

describe("serviceendpoint (webhook) payload", () => {
  it("uses the documented option-set values for a JSON webhook", () => {
    const payload = buildServiceEndpointPayload({
      name: "MyFunction",
      url: "https://myfn.azurewebsites.net/api/OnAccountCreate",
      authType: WebhookAuthType.webhookKey,
      authValue: "secret-key",
    });

    expect(payload).toEqual({
      name: "MyFunction",
      url: "https://myfn.azurewebsites.net/api/OnAccountCreate",
      contract: SERVICE_ENDPOINT_CONTRACT_WEBHOOK,
      messageformat: SERVICE_ENDPOINT_MESSAGE_FORMAT_JSON,
      connectionmode: SERVICE_ENDPOINT_CONNECTION_MODE_NORMAL,
      authtype: WebhookAuthType.webhookKey,
      authvalue: "secret-key",
      userclaim: WebhookUserClaim.none,
    });
    expect(SERVICE_ENDPOINT_CONTRACT_WEBHOOK).toBe(8);
    expect(SERVICE_ENDPOINT_MESSAGE_FORMAT_JSON).toBe(2);
    expect(WebhookAuthType.webhookKey).toBe(4);
    expect(WebhookAuthType.httpHeader).toBe(5);
  });

  it("carries the http-header auth type, user claim and description through", () => {
    const payload = buildServiceEndpointPayload({
      name: "MyFunction",
      url: " https://myfn.azurewebsites.net/api/Hook ",
      authType: WebhookAuthType.httpHeader,
      authValue: "x-functions-key=abc",
      userClaim: WebhookUserClaim.userId,
      description: "Azure Function webhook",
    });

    expect(payload.authtype).toBe(5);
    expect(payload.authvalue).toBe("x-functions-key=abc");
    expect(payload.userclaim).toBe(WebhookUserClaim.userId);
    expect(payload.description).toBe("Azure Function webhook");
    expect(payload.url).toBe("https://myfn.azurewebsites.net/api/Hook");
  });

  it("builds the auth value per auth type", () => {
    expect(buildAuthValue(WebhookAuthType.webhookKey, "abc")).toBe("abc");
    expect(buildAuthValue(WebhookAuthType.httpHeader, "abc")).toBe("x-functions-key=abc");
    expect(buildAuthValue(WebhookAuthType.httpHeader, "abc", "x-custom")).toBe("x-custom=abc");
  });

  it("only accepts absolute https urls", () => {
    expect(isValidWebhookUrl("https://myfn.azurewebsites.net/api/Hook")).toBe(true);
    expect(isValidWebhookUrl("http://myfn.azurewebsites.net/api/Hook")).toBe(false);
    expect(isValidWebhookUrl("myfn.azurewebsites.net")).toBe(false);
    expect(isValidWebhookUrl("")).toBe(false);
  });
});

describe("sdkmessageprocessingstep (webhook) payload", () => {
  it("binds eventhandler to the serviceendpoint, not a plugin type", () => {
    const payload = buildWebhookStepPayload(
      {
        stepName: "MyFunction: Create of account",
        messageName: "Create",
        entityLogicalName: "account",
        stage: StepStage.postOperation,
        mode: StepMode.synchronous,
      },
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
    );

    expect(payload["eventhandler_serviceendpoint@odata.bind"]).toBe("/serviceendpoints(11111111-1111-1111-1111-111111111111)");
    expect(payload["sdkmessageid@odata.bind"]).toBe("/sdkmessages(22222222-2222-2222-2222-222222222222)");
    expect(payload["sdkmessagefilterid@odata.bind"]).toBe("/sdkmessagefilters(33333333-3333-3333-3333-333333333333)");
    expect(payload["plugintypeid@odata.bind"]).toBeUndefined();
    expect(payload.stage).toBe(40);
    expect(payload.mode).toBe(0);
    expect(payload.rank).toBe(1);
    expect(payload.supporteddeployment).toBe(0);
    expect(payload.filteringattributes).toBe("");
    // asyncautodelete is meaningless for a synchronous step.
    expect(payload.asyncautodelete).toBeUndefined();
  });

  it("omits the message filter bind when the message has no primary entity", () => {
    const payload = buildWebhookStepPayload(
      { stepName: "MyFunction: WhoAmI", messageName: "WhoAmI", stage: StepStage.postOperation, mode: StepMode.asynchronous },
      "endpoint-id",
      "message-id",
    );

    expect(payload["sdkmessagefilterid@odata.bind"]).toBeUndefined();
    expect(payload.asyncautodelete).toBe(true);
    expect(payload.mode).toBe(1);
  });

  it("carries filtering attributes, rank and async-auto-delete overrides", () => {
    const payload = buildWebhookStepPayload(
      {
        stepName: "step",
        messageName: "Update",
        entityLogicalName: "account",
        stage: StepStage.preOperation,
        mode: StepMode.asynchronous,
        filteringAttributes: "name,telephone1",
        executionOrder: 7,
        asyncAutoDelete: false,
        description: "d",
      },
      "endpoint-id",
      "message-id",
    );

    expect(payload.filteringattributes).toBe("name,telephone1");
    expect(payload.rank).toBe(7);
    expect(payload.asyncautodelete).toBe(false);
    expect(payload.stage).toBe(20);
    expect(payload.description).toBe("d");
  });

  it("names steps the way the plugin registration tool does", () => {
    expect(buildWebhookStepName("MyFunction", "Create", "account")).toBe("MyFunction: Create of account");
    expect(buildWebhookStepName("MyFunction", "WhoAmI")).toBe("MyFunction: WhoAmI");
  });
});
