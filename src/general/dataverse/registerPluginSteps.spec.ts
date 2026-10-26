// Dataverse OData field names (e.g. _sdkmessagefilterid_value) are not identifiers.
/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { registerPluginSteps } from "./registerPluginSteps";
import { PluginStepRegistration, StepImageType } from "./stepPayloads";
import { fakeDataverseContext, okJson } from "../../../test/dataverseTestUtils";

// #143 Move 2 — verify the plugin-step registration orchestration (used by plugin
// Build & Deploy) against a mocked Web API: create vs update vs unchanged vs skip.

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => fetchMock.mockReset());

function jsonPost(body: unknown) {
  return { ok: true, status: 200, statusText: "OK", headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
}

const step: PluginStepRegistration = {
  className: "MyPlugin",
  fullTypeName: "NS.MyPlugin",
  messageName: "Update",
  entityLogicalName: "account",
  stage: 40,
  mode: 0,
  filteringAttributes: "name",
  stepName: "NS.MyPlugin: Update of account",
  executionOrder: 1,
};

interface Routes {
  pluginType?: unknown[];
  message?: unknown[];
  filter?: unknown[];
  existingStep?: unknown[];
  snapshot?: unknown;
  images?: unknown[];
}

function route(routes: Routes) {
  fetchMock.mockImplementation((url: string, opts: { method?: string } = {}) => {
    const method = opts.method ?? "GET";
    const u = String(url);
    if (method === "GET" && u.includes("sdkmessageprocessingstepimages?")) {
      return Promise.resolve(okJson({ value: routes.images ?? [] }));
    }
    if (method === "POST" && u.includes("sdkmessageprocessingstepimages")) {
      return Promise.resolve(jsonPost({ sdkmessageprocessingstepimageid: "img-new" }));
    }
    if (method === "GET" && u.includes("plugintypes")) {
      return Promise.resolve(okJson({ value: routes.pluginType ?? [{ plugintypeid: "pt-1" }] }));
    }
    if (method === "GET" && u.includes("sdkmessageprocessingsteps(")) {
      return Promise.resolve(okJson(routes.snapshot ?? {}));
    }
    if (method === "GET" && u.includes("sdkmessageprocessingsteps?")) {
      return Promise.resolve(okJson({ value: routes.existingStep ?? [] }));
    }
    if (method === "GET" && u.includes("sdkmessagefilters")) {
      return Promise.resolve(okJson({ value: routes.filter ?? [{ sdkmessagefilterid: "filt-1" }] }));
    }
    if (method === "GET" && u.includes("sdkmessages?")) {
      return Promise.resolve(okJson({ value: routes.message ?? [{ sdkmessageid: "msg-1" }] }));
    }
    if (method === "POST" && u.includes("sdkmessageprocessingsteps")) {
      return Promise.resolve(jsonPost({ sdkmessageprocessingstepid: "step-new" }));
    }
    return Promise.resolve(jsonPost({})); // PATCH
  });
}

function methodCalls(method: string, urlPart: string): number {
  return fetchMock.mock.calls.filter((c) => (c[1]?.method ?? "GET") === method && String(c[0]).includes(urlPart)).length;
}

describe("registerPluginSteps — orchestration vs mocked Web API (#143 Move 2)", () => {
  it("creates a step when none exists", async () => {
    route({ existingStep: [] });
    const { context } = fakeDataverseContext();
    const result = await registerPluginSteps(context, "asm-1", [step]);
    expect(result).toMatchObject({ created: 1, updated: 0, unchanged: 0, skipped: 0 });
    expect(methodCalls("POST", "sdkmessageprocessingsteps")).toBe(1);
  });

  it("leaves an identical step unchanged (no PATCH)", async () => {
    route({
      existingStep: [{ sdkmessageprocessingstepid: "s1", name: step.stepName }],
      snapshot: { sdkmessageprocessingstepid: "s1", name: step.stepName, rank: 1, stage: 40, mode: 0, filteringattributes: "name", _sdkmessagefilterid_value: "filt-1" },
    });
    const { context } = fakeDataverseContext();
    const result = await registerPluginSteps(context, "asm-1", [step]);
    expect(result).toMatchObject({ unchanged: 1, updated: 0, created: 0 });
    expect(methodCalls("PATCH", "sdkmessageprocessingsteps(s1)")).toBe(0);
  });

  it("updates a step whose config differs", async () => {
    route({
      existingStep: [{ sdkmessageprocessingstepid: "s1", name: step.stepName }],
      snapshot: { sdkmessageprocessingstepid: "s1", name: step.stepName, rank: 9, stage: 40, mode: 0, filteringattributes: "name", _sdkmessagefilterid_value: "filt-1" },
    });
    const { context } = fakeDataverseContext();
    const result = await registerPluginSteps(context, "asm-1", [step]);
    expect(result).toMatchObject({ updated: 1, created: 0, unchanged: 0 });
    expect(methodCalls("PATCH", "sdkmessageprocessingsteps(s1)")).toBe(1);
  });

  it("skips a step whose plugin type isn't in the assembly", async () => {
    route({ pluginType: [] });
    const { context } = fakeDataverseContext();
    const result = await registerPluginSteps(context, "asm-1", [step]);
    expect(result).toMatchObject({ skipped: 1, created: 0 });
    expect(methodCalls("POST", "sdkmessageprocessingsteps")).toBe(0);
  });
});

describe("registerPluginSteps — step images", () => {
  const unchangedSnapshot = {
    sdkmessageprocessingstepid: "s1",
    name: step.stepName,
    rank: 1,
    stage: 40,
    mode: 0,
    filteringattributes: "name",
    _sdkmessagefilterid_value: "filt-1",
  };
  const stepWithImage: PluginStepRegistration = { ...step, images: [{ name: "PreImage", imageType: StepImageType.preImage, attributes: "name" }] };

  function postedBody(urlPart: string): Record<string, unknown> {
    const call = fetchMock.mock.calls.find((c) => c[1]?.method === "POST" && String(c[0]).includes(urlPart));
    return JSON.parse(call?.[1]?.body as string);
  }

  it("creates a declared image on a newly created step", async () => {
    route({ existingStep: [] });
    const { context } = fakeDataverseContext();

    const result = await registerPluginSteps(context, "asm-1", [stepWithImage]);

    expect(result.images).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 0 });
    expect(postedBody("sdkmessageprocessingstepimages")).toEqual({
      name: "PreImage",
      entityalias: "PreImage",
      imagetype: 0,
      attributes: "name",
      messagepropertyname: "Target",
      "sdkmessageprocessingstepid@odata.bind": "/sdkmessageprocessingsteps(step-new)",
    });
  });

  it("creates a declared image missing from an existing step", async () => {
    route({ existingStep: [{ sdkmessageprocessingstepid: "s1", name: step.stepName }], snapshot: unchangedSnapshot, images: [] });
    const { context } = fakeDataverseContext();

    const result = await registerPluginSteps(context, "asm-1", [stepWithImage]);

    expect(result).toMatchObject({ unchanged: 1, images: { created: 1 } });
    expect(postedBody("sdkmessageprocessingstepimages")["sdkmessageprocessingstepid@odata.bind"]).toBe("/sdkmessageprocessingsteps(s1)");
  });

  it("leaves an identical image unchanged", async () => {
    route({
      existingStep: [{ sdkmessageprocessingstepid: "s1", name: step.stepName }],
      snapshot: unchangedSnapshot,
      images: [{ sdkmessageprocessingstepimageid: "i1", name: "PreImage", entityalias: "PreImage", imagetype: 0, attributes: "name", messagepropertyname: "Target" }],
    });
    const { context } = fakeDataverseContext();

    const result = await registerPluginSteps(context, "asm-1", [stepWithImage]);

    expect(result.images).toEqual({ created: 0, updated: 0, unchanged: 1, skipped: 0 });
    expect(methodCalls("PATCH", "sdkmessageprocessingstepimages")).toBe(0);
  });

  it("updates an image whose attributes differ, matched by alias", async () => {
    route({
      existingStep: [{ sdkmessageprocessingstepid: "s1", name: step.stepName }],
      snapshot: unchangedSnapshot,
      images: [{ sdkmessageprocessingstepimageid: "i1", name: "PreImage", entityalias: "preimage", imagetype: 0, attributes: "telephone1", messagepropertyname: "Target" }],
    });
    const { context } = fakeDataverseContext();

    const result = await registerPluginSteps(context, "asm-1", [stepWithImage]);

    expect(result.images).toMatchObject({ updated: 1, created: 0 });
    expect(methodCalls("PATCH", "sdkmessageprocessingstepimages(i1)")).toBe(1);
  });

  it("skips an image Dataverse would reject and logs why", async () => {
    route({ existingStep: [{ sdkmessageprocessingstepid: "s1", name: step.stepName }], snapshot: unchangedSnapshot, images: [] });
    const { context, lines } = fakeDataverseContext();
    const invalid: PluginStepRegistration = { ...step, stage: 20, images: [{ name: "PostImage", imageType: StepImageType.postImage }] };

    const result = await registerPluginSteps(context, "asm-1", [invalid]);

    expect(result.images).toMatchObject({ skipped: 1, created: 0 });
    expect(methodCalls("POST", "sdkmessageprocessingstepimages")).toBe(0);
    expect(lines.some((line) => line.includes("post-image is only available on a PostOperation step"))).toBe(true);
  });

  it("does not query images for a step that declares none", async () => {
    route({ existingStep: [{ sdkmessageprocessingstepid: "s1", name: step.stepName }], snapshot: unchangedSnapshot });
    const { context } = fakeDataverseContext();

    const result = await registerPluginSteps(context, "asm-1", [step]);

    expect(result.images).toEqual({ created: 0, updated: 0, unchanged: 0, skipped: 0 });
    expect(methodCalls("GET", "sdkmessageprocessingstepimages")).toBe(0);
  });
});
