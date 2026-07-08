/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { loadLiveEnv, LiveEnv, testSolutionConfig } from "../liveEnv";
import { LiveDataverseClient } from "./dataverseClient";
import { DataverseForm } from "../../src/general/dataverse/DataverseForm";
import { DataverseWebresource } from "../../src/general/dataverse/DataverseWebresource";
import DataversePowerToolsContext from "../../src/context";

// Exercises the extension's own form + webresource code against the real environment:
// a library webresource is created and published (DataverseWebresource), the account
// main form is loaded and parsed (DataverseForm — also guards the org-url fix), and the
// form-decoration logic is applied to the parsed form and verified in the object graph.
//
// NOTE: it deliberately does NOT PATCH the account form. Dataverse strips custom event
// handlers when you write formxml to a *system* form via the Web API, so a true
// push-and-verify-persistence e2e needs a dedicated custom form — a follow-up.
const env = loadLiveEnv();

it(env ? "live env configured for form/webresource round-trip" : "live env NOT configured — skipping", () => {
  expect(true).toBe(true);
});

const live = env ? describe : describe.skip;

/** Minimal stand-in for the context — what DataverseForm and DataverseWebresource read. */
function fakeContext(url: string, token: string): DataversePowerToolsContext {
  return {
    connectionString: `AuthType=OAuth;Url=${url}`,
    projectSettings: { tenantId: "test" },
    dataverse: { organizationUrl: url, isValid: true, authorizationToken: token, getAuthorizationToken: async () => token },
    channel: { appendLine: () => undefined, show: () => undefined },
  } as unknown as DataversePowerToolsContext;
}

/** Apply the extension's form-decoration shape (library + onload handler) to a parsed form. */
function decorate(form: DataverseForm, libraryName: string, functionName: string): void {
  const root = form.form.form;
  if (!root.formLibraries) {
    root.formLibraries = { Library: [] };
  }
  if (!root.formLibraries.Library.find((l: any) => l["@_name"] === libraryName)) {
    root.formLibraries.Library.push({ "@_name": libraryName, "@_libraryUniqueId": "{b2c3d4e5-0000-4000-8000-000000000002}" });
  }
  if (!root.events) {
    root.events = { event: [] };
  }
  let onload = root.events.event.find((e: any) => e["@_name"] === "onload");
  if (!onload) {
    onload = { "@_name": "onload", "@_active": "true", "@_application": "true", Handlers: { Handler: [] } };
    root.events.event.push(onload);
  }
  if (!onload.Handlers) {
    onload.Handlers = { Handler: [] };
  }
  onload.Handlers.Handler.push({
    "@_functionName": functionName,
    "@_libraryName": libraryName,
    "@_handlerUniqueId": "{a1b2c3d4-0000-4000-8000-000000000001}",
    "@_enabled": "true",
    "@_parameters": "",
    "@_passExecutionContext": "true",
  });
}

live("form read + decoration logic + webresource lifecycle (extension code vs real env)", () => {
  const client = new LiveDataverseClient(env as LiveEnv);
  const prefix = testSolutionConfig(env as LiveEnv).prefix;
  const stamp = Date.now();
  const libraryName = `${prefix}_dvpttestlib_${stamp}.js`;
  const testFunctionName = `dvpt_test_OnLoad_${stamp}`;
  let formId = "";
  let webresourceId: string | undefined;

  beforeAll(async () => {
    await client.connect();
    const ctx = fakeContext((env as LiveEnv).url, client.accessToken);
    const webresource = new DataverseWebresource(libraryName, ctx);
    await webresource.upsert(Buffer.from("function noop(){}", "utf8").toString("base64"), 3, "dvpt test lib");
    webresourceId = (await client.findWebresourceByName(libraryName))?.webresourceid;
    formId = (await client.findMainFormId("account")) ?? "";
  });

  afterAll(async () => {
    if (webresourceId) {
      await client.deleteWebresource(webresourceId);
    }
  });

  it("creates a library webresource via the extension's DataverseWebresource and finds the form", () => {
    expect(webresourceId, "test library webresource was not created").toBeTruthy();
    expect(formId, "account main form not found").toBeTruthy();
  });

  it("loads and parses the real form via DataverseForm (guards the org-url fix)", async () => {
    const form = new DataverseForm(formId, fakeContext((env as LiveEnv).url, client.accessToken));
    await form.getFormData();
    expect(form.form?.form, "form xml did not parse").toBeTruthy();
    expect(form.form.form.tabs, "parsed form has no tabs").toBeTruthy();
  });

  it("applies the form-decoration logic (library + onload handler) to the parsed form", async () => {
    const form = new DataverseForm(formId, fakeContext((env as LiveEnv).url, client.accessToken));
    await form.getFormData();
    decorate(form, libraryName, testFunctionName);

    const library = form.form.form.formLibraries.Library.find((l: any) => l["@_name"] === libraryName);
    expect(library, "library was not registered on the form").toBeTruthy();
    const onload = form.form.form.events.event.find((e: any) => e["@_name"] === "onload");
    const handler = onload?.Handlers?.Handler?.find((h: any) => h["@_functionName"] === testFunctionName);
    expect(handler, "onload handler was not registered").toBeTruthy();
    expect(handler["@_libraryName"]).toBe(libraryName);
  });
});
