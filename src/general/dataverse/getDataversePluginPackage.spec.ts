import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import * as fs from "fs";
import { getDataversePluginPackageId, upsertDataversePluginPackage, waitForDataversePluginAssemblyFromPackage } from "./getDataversePluginPackage";
import { fakeDataverseContext, okJson, httpError } from "../../../test/dataverseTestUtils";

// #143 Move 2 — the plugin-PACKAGE deploy path (create/update the pluginpackage + wait for its
// assembly to materialise) against a mocked node-fetch, no live org. Guards the create-vs-update
// upsert branching and the OData-EntityId header id-parse (create returns 204, no JSON body).

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;

/** A create response: 204 No Content with the new id in the OData-EntityId header. */
function createdViaHeader(id: string) {
  return {
    ok: true,
    status: 204,
    statusText: "No Content",
    headers: { get: (k: string) => (k === "OData-EntityId" ? `https://org.crm.dynamics.com/api/data/v9.2/pluginpackages(${id})` : null) },
    json: async () => ({}),
    text: async () => "",
  };
}

const META = { name: "Contoso Plugins", uniqueName: "contoso_plugins", version: "1.0.0.0" };

beforeEach(() => {
  fetchMock.mockReset();
  vi.spyOn(fs.promises, "readFile").mockResolvedValue(Buffer.from("DLLBYTES"));
});

describe("getDataversePluginPackageId", () => {
  it("looks up a package by unique name and returns its id", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ pluginpackageid: "pkg-1", uniquename: META.uniqueName }] }));
    const { context } = fakeDataverseContext();
    expect(await getDataversePluginPackageId(context, META.uniqueName)).toBe("pkg-1");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("pluginpackages?");
    expect(url).toContain("uniquename");
  });

  it("escapes a single quote in the unique name (OData injection guard)", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [] }));
    const { context } = fakeDataverseContext();
    await getDataversePluginPackageId(context, "o'brien");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("o''brien"); // the single quote is doubled (OData escaping)
  });

  it("returns undefined on an empty result or a non-OK response", async () => {
    const { context } = fakeDataverseContext();
    fetchMock.mockResolvedValue(okJson({ value: [] }));
    expect(await getDataversePluginPackageId(context, META.uniqueName)).toBeUndefined();
    fetchMock.mockResolvedValue(httpError(404, "Not Found"));
    expect(await getDataversePluginPackageId(context, META.uniqueName)).toBeUndefined();
  });
});

describe("upsertDataversePluginPackage", () => {
  it("CREATES when the package doesn't exist, reading the new id from the OData-EntityId header", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [] })); // lookup: none
    fetchMock.mockResolvedValueOnce(createdViaHeader("pkg-new")); // POST create
    const { context } = fakeDataverseContext();
    const result = await upsertDataversePluginPackage(context, META, "/tmp/pkg.nupkg");
    expect(result).toEqual({ pluginPackageId: "pkg-new", created: true, updated: false });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
  });

  it("UPDATES (PATCH) when the package already exists", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ pluginpackageid: "pkg-existing" }] })); // lookup: found
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, statusText: "No Content", json: async () => ({}), text: async () => "" }); // PATCH
    const { context } = fakeDataverseContext();
    const result = await upsertDataversePluginPackage(context, META, "/tmp/pkg.nupkg");
    expect(result).toEqual({ pluginPackageId: "pkg-existing", created: false, updated: true });
    const patch = fetchMock.mock.calls[1];
    expect(patch[0]).toContain("pluginpackages(pkg-existing)");
    expect(patch[1]).toMatchObject({ method: "PATCH" });
  });
});

describe("waitForDataversePluginAssemblyFromPackage", () => {
  it("returns the assembly id once it appears, filtered by package + name", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ pluginassemblyid: "asm-1", name: "Contoso.Plugins" }] }));
    const { context } = fakeDataverseContext();
    const id = await waitForDataversePluginAssemblyFromPackage(context, "pkg-1", "Contoso.Plugins");
    expect(id).toBe("asm-1");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("_packageid_value eq pkg-1");
  });

  it("returns undefined when the assembly never appears within the window", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [] }));
    const { context } = fakeDataverseContext();
    // maxWait 0 + pollInterval 0 → one poll, empty, then the window is exhausted.
    expect(await waitForDataversePluginAssemblyFromPackage(context, "pkg-1", "Contoso.Plugins", 0, 0)).toBeUndefined();
  });

  it("returns undefined on a non-OK response", async () => {
    fetchMock.mockResolvedValue(httpError(500, "Server Error"));
    const { context } = fakeDataverseContext();
    expect(await waitForDataversePluginAssemblyFromPackage(context, "pkg-1", "Contoso.Plugins")).toBeUndefined();
  });
});
