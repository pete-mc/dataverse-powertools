import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { DataverseForm } from "./DataverseForm";
import { fakeDataverseContext, okJson, httpError } from "../../../test/dataverseTestUtils";

// #143 Move 2 — the form-registration path (load formxml → edit → save) against a mocked node-fetch,
// no live org. Guards the load/save success + failure returns (#90: a failed save must surface, not
// look like success) and the connection gate (canCallDataverseApi, never tenantId — the OAuth guard).

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => fetchMock.mockReset());

const FORM_XML = `<form><events><event name="onload"><Handlers><Handler functionName="onLoad" libraryName="new_lib.js" /></Handlers></event></events></form>`;

describe("DataverseForm.getFormData", () => {
  it("loads and parses the form xml (returns true)", async () => {
    fetchMock.mockResolvedValue(okJson({ formxml: FORM_XML }));
    const { context } = fakeDataverseContext();
    const form = new DataverseForm("form-1", context);
    expect(await form.getFormData()).toBe(true);
    expect(form.form).toBeDefined();
    expect(form.form.form).toBeDefined();
    expect(fetchMock.mock.calls[0][0]).toContain("systemforms(form-1)?$select=formxml");
  });

  it("returns false on a non-OK response (the caller must not proceed — #90)", async () => {
    fetchMock.mockResolvedValue(httpError(404, "Not Found"));
    const { context } = fakeDataverseContext();
    expect(await new DataverseForm("form-1", context).getFormData()).toBe(false);
  });

  it("returns false without a network call when the connection can't reach Dataverse", async () => {
    const { context, lines } = fakeDataverseContext({ isValid: false });
    expect(await new DataverseForm("form-1", context).getFormData()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("Could not connect to dataverse");
  });
});

describe("DataverseForm.saveForm", () => {
  it("PATCHes the rebuilt formxml back to the form (returns true)", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ formxml: FORM_XML })); // getFormData
    fetchMock.mockResolvedValueOnce(okJson({})); // saveForm PATCH
    const { context } = fakeDataverseContext();
    const form = new DataverseForm("form-1", context);
    await form.getFormData();
    expect(await form.saveForm()).toBe(true);
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toContain("systemforms(form-1)");
    expect(options).toMatchObject({ method: "PATCH" });
    const body = JSON.parse((options as any).body);
    expect(body.formxml).toContain("<events>");
  });

  it("returns false on a non-OK save (a 400 for an undeployed web resource must surface — #90)", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ formxml: FORM_XML })); // getFormData
    fetchMock.mockResolvedValueOnce(httpError(400, "Bad Request", "web resource not found")); // save
    const { context } = fakeDataverseContext();
    const form = new DataverseForm("form-1", context);
    await form.getFormData();
    expect(await form.saveForm()).toBe(false);
  });

  it("returns false without a network call when the connection is invalid", async () => {
    const { context } = fakeDataverseContext({ isValid: false });
    expect(await new DataverseForm("form-1", context).saveForm()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
