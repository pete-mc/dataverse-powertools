import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import { deployOne } from "./deployCustomApi";
import { fakeDataverseContext, okJson } from "../../test/dataverseTestUtils";
import { newCustomApiDefinition, CustomApiDefinition } from "./definition";

// #143 Move 2 — verify the Custom API metadata-deploy orchestration (shipped in
// 0.14.7) against a mocked Dataverse Web API: does it hit the right endpoints, in
// the right order, and reconcile (create/update/DELETE) correctly — no live org.

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => fetchMock.mockReset());

// The extension parses the new id from the OData-EntityId header, which requires a
// 36-char GUID — use a real GUID shape so createRecord resolves an id.
const GUID = "12345678-1234-1234-1234-123456789012";
function created(_id: string) {
  return {
    ok: true,
    status: 204,
    statusText: "",
    headers: { get: (k: string) => (k.toLowerCase() === "odata-entityid" ? `https://org.crm.dynamics.com/api/data/v9.2/x(${GUID})` : null) },
    json: async () => ({}),
    text: async () => "",
  };
}
function noContent() {
  return { ok: true, status: 204, statusText: "", headers: { get: () => null }, json: async () => ({}), text: async () => "" };
}

interface Routes {
  pluginTypes?: unknown[];
  existingApi?: unknown[];
  existingReqParams?: unknown[];
  existingRespProps?: unknown[];
}

function route(routes: Routes) {
  fetchMock.mockImplementation((url: string, opts: { method?: string } = {}) => {
    const method = opts.method ?? "GET";
    const u = String(url);
    if (method === "GET" && u.includes("plugintypes")) {
      return Promise.resolve(okJson({ value: routes.pluginTypes ?? [{ plugintypeid: "pt-1" }] }));
    }
    if (method === "GET" && u.includes("customapirequestparameters")) {
      return Promise.resolve(okJson({ value: routes.existingReqParams ?? [] }));
    }
    if (method === "GET" && u.includes("customapiresponseproperties")) {
      return Promise.resolve(okJson({ value: routes.existingRespProps ?? [] }));
    }
    if (method === "GET" && u.includes("customapis")) {
      return Promise.resolve(okJson({ value: routes.existingApi ?? [] }));
    }
    if (method === "POST" && u.includes("customapirequestparameters")) {
      return Promise.resolve(created("rp-new"));
    }
    if (method === "POST" && u.includes("customapiresponseproperties")) {
      return Promise.resolve(created("rprop-new"));
    }
    if (method === "POST" && u.includes("customapis")) {
      return Promise.resolve(created("api-1"));
    }
    return Promise.resolve(noContent()); // PATCH / DELETE
  });
}

function callsMatching(method: string, urlPart: string): number {
  return fetchMock.mock.calls.filter((c) => (c[1]?.method ?? "GET") === method && String(c[0]).includes(urlPart)).length;
}

describe("deployOne — orchestration against a mocked Web API (#143 Move 2)", () => {
  it("creates a new CustomAPI + its parameters when none exists", async () => {
    route({ existingApi: [] });
    const { context } = fakeDataverseContext();
    const ok = await deployOne(context, newCustomApiDefinition("sample_Do", "Sample.Plugins.Do"));
    expect(ok).toBe(true);
    expect(callsMatching("POST", "/customapis")).toBe(1);
    expect(callsMatching("POST", "/customapirequestparameters")).toBe(1); // sample has 1 request param
    expect(callsMatching("POST", "/customapiresponseproperties")).toBe(1); // and 1 response prop
  });

  it("updates (PATCH) an existing CustomAPI instead of creating", async () => {
    route({ existingApi: [{ customapiid: "api-1" }] });
    const { context } = fakeDataverseContext();
    await deployOne(context, newCustomApiDefinition("sample_Do", "Sample.Plugins.Do"));
    expect(callsMatching("POST", "/customapis")).toBe(0);
    expect(callsMatching("PATCH", "/customapis(api-1)")).toBe(1);
  });

  it("reconciles: DELETEs a parameter that's no longer in the definition", async () => {
    route({
      existingApi: [{ customapiid: "api-1" }],
      existingReqParams: [
        { customapirequestparameterid: "rp-keep", uniquename: "InputValue" }, // matches sample → update
        { customapirequestparameterid: "rp-drop", uniquename: "OldParam" }, // gone from def → delete
      ],
    });
    const { context } = fakeDataverseContext();
    await deployOne(context, newCustomApiDefinition("sample_Do", "Sample.Plugins.Do"));
    expect(callsMatching("DELETE", "/customapirequestparameters(rp-drop)")).toBe(1);
    expect(callsMatching("PATCH", "/customapirequestparameters(rp-keep)")).toBe(1);
    expect(callsMatching("DELETE", "/customapirequestparameters(rp-keep)")).toBe(0);
  });

  it("fails (returns false) when the implementing plugin type is not deployed", async () => {
    route({ pluginTypes: [] });
    const { context } = fakeDataverseContext();
    const ok = await deployOne(context, newCustomApiDefinition("sample_Do", "Sample.Plugins.Do"));
    expect(ok).toBe(false);
    expect(callsMatching("POST", "/customapis")).toBe(0);
  });
});
