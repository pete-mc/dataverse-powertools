import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { findWebhookServiceEndpointId, upsertWebhookServiceEndpoint, registerWebhookStep } from "./serviceEndpoints";
import { WebhookAuthType, StepStage, StepMode, WebhookEndpointDefinition, WebhookStepDefinition } from "../../azurefunction/webhookPayloads";
import { fakeDataverseContext, okJson } from "../../../test/dataverseTestUtils";

// #143 Move 2 — the WEBHOOK registration path (#145: serviceendpoint + its sdkmessageprocessingstep)
// against a mocked node-fetch, no live org. Guards the create-vs-update upsert branching and the
// message/filter resolution short-circuits. Auth gates on the live connection (canCallDataverseApi),
// never tenantId — so this works under interactive (OAuth) auth too (#90/#91).

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => fetchMock.mockReset());

const ENDPOINT: WebhookEndpointDefinition = {
  name: "MyFunctionHook",
  url: "https://fn.azurewebsites.net/api/hook",
  authType: WebhookAuthType.httpHeader,
  authValue: "x-functions-key=secret",
};

const STEP: WebhookStepDefinition = {
  stepName: "MyFunctionHook: Create of account",
  messageName: "Create",
  entityLogicalName: "account",
  stage: StepStage.postOperation,
  mode: StepMode.asynchronous,
};

describe("findWebhookServiceEndpointId", () => {
  it("returns the id of an existing endpoint by name (OData-escaped)", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ serviceendpointid: "sep-1", name: ENDPOINT.name }] }));
    const { context } = fakeDataverseContext();
    expect(await findWebhookServiceEndpointId(context, "O'Hook")).toBe("sep-1");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("serviceendpoints?");
    expect(url).toContain("O''Hook"); // single quote doubled
  });

  it("returns undefined when none exists", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [] }));
    const { context } = fakeDataverseContext();
    expect(await findWebhookServiceEndpointId(context, ENDPOINT.name)).toBeUndefined();
  });
});

describe("upsertWebhookServiceEndpoint", () => {
  it("CREATES the endpoint when none exists (lookup empty → POST)", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [] })); // lookup
    fetchMock.mockResolvedValueOnce(okJson({ serviceendpointid: "sep-new" })); // POST create
    const { context } = fakeDataverseContext();
    expect(await upsertWebhookServiceEndpoint(context, ENDPOINT)).toEqual({ serviceEndpointId: "sep-new", created: true, updated: false });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
  });

  it("UPDATES the existing endpoint (lookup hit → PATCH)", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ serviceendpointid: "sep-existing" }] })); // lookup
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, statusText: "No Content", json: async () => ({}), text: async () => "" }); // PATCH (204)
    const { context } = fakeDataverseContext();
    expect(await upsertWebhookServiceEndpoint(context, ENDPOINT)).toEqual({ serviceEndpointId: "sep-existing", created: false, updated: true });
    const patch = fetchMock.mock.calls[1];
    expect(patch[0]).toContain("serviceendpoints(sep-existing)");
    expect(patch[1]).toMatchObject({ method: "PATCH" });
  });
});

describe("registerWebhookStep", () => {
  it("errors when the SDK message isn't found (no write attempted)", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [] })); // resolveSdkMessageId → none
    const { context } = fakeDataverseContext();
    const result = await registerWebhookStep(context, "sep-1", STEP);
    expect(result.created).toBe(false);
    expect(result.error).toContain("was not found");
  });

  it("errors when the message isn't available for the table (filter not found)", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ sdkmessageid: "msg-1" }] })); // message resolved
    fetchMock.mockResolvedValueOnce(okJson({ value: [] })); // filter → none
    const { context } = fakeDataverseContext();
    const result = await registerWebhookStep(context, "sep-1", STEP);
    expect(result.error).toContain("not available for table 'account'");
  });

  it("CREATES the step when message + filter resolve and none exists", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ sdkmessageid: "msg-1" }] })); // message
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ sdkmessagefilterid: "flt-1" }] })); // filter
    fetchMock.mockResolvedValueOnce(okJson({ value: [] })); // existing step → none
    fetchMock.mockResolvedValueOnce(okJson({ sdkmessageprocessingstepid: "step-new" })); // POST
    const { context } = fakeDataverseContext();
    expect(await registerWebhookStep(context, "sep-1", STEP)).toEqual({ stepId: "step-new", created: true, updated: false });
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: "POST" });
  });

  it("UPDATES the step when one already exists for this endpoint", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ sdkmessageid: "msg-1" }] })); // message
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ sdkmessagefilterid: "flt-1" }] })); // filter
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ sdkmessageprocessingstepid: "step-existing" }] })); // existing step
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, statusText: "No Content", json: async () => ({}), text: async () => "" }); // PATCH
    const { context } = fakeDataverseContext();
    expect(await registerWebhookStep(context, "sep-1", STEP)).toEqual({ stepId: "step-existing", created: false, updated: true });
  });
});

describe("auth gating (the #90/#91 OAuth guard)", () => {
  it("does not touch the network when the connection can't call the API", async () => {
    // isValid:false with no organizationUrl override still initialises; force an unusable connection.
    const { context } = fakeDataverseContext({ isValid: false, organizationUrl: "" });
    // initialize() is a no-op stub that leaves isValid falsey → canCallDataverseApi is false.
    expect(await findWebhookServiceEndpointId(context, ENDPOINT.name)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
