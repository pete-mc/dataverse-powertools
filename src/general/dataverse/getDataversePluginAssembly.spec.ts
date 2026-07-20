import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
import fetch from "node-fetch";
import * as fs from "fs";
import {
  getDataversePluginAssemblyId,
  createDataversePluginAssembly,
  ensureDataversePluginAssemblyId,
  updateDataversePluginAssemblyContent,
  upsertDataversePluginAssembly,
} from "./getDataversePluginAssembly";
import { fakeDataverseContext, okJson, httpError } from "../../../test/dataverseTestUtils";

// #143 Move 2 — the classic (non-package) plugin-ASSEMBLY deploy path against a mocked node-fetch,
// no live org. Guards the create-vs-update upsert branching and the strong-name (0x8004416c)
// guidance that a --skip-signing assembly triggers.

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock.mockReset();
  vi.spyOn(fs.promises, "readFile").mockResolvedValue(Buffer.from("DLLBYTES"));
});

describe("getDataversePluginAssemblyId", () => {
  it("looks up an assembly by name and returns its id", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ pluginassemblyid: "asm-1", name: "Contoso.Plugins" }] }));
    const { context } = fakeDataverseContext();
    expect(await getDataversePluginAssemblyId(context, "Contoso.Plugins")).toBe("asm-1");
    expect(fetchMock.mock.calls[0][0]).toContain("pluginassemblies?");
  });

  it("returns undefined on an empty result", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [] }));
    const { context } = fakeDataverseContext();
    expect(await getDataversePluginAssemblyId(context, "Contoso.Plugins")).toBeUndefined();
  });

  it("logs strong-name guidance when the API rejects an unsigned assembly (0x8004416c)", async () => {
    fetchMock.mockResolvedValue(httpError(400, "Bad Request", "error 0x8004416c: public assembly must have public key token"));
    const { context, lines } = fakeDataverseContext();
    expect(await getDataversePluginAssemblyId(context, "Contoso.Plugins")).toBeUndefined();
    expect(lines.join("\n")).toContain("strong-named assembly");
  });
});

describe("createDataversePluginAssembly", () => {
  it("POSTs the base64 assembly content and returns the new id", async () => {
    fetchMock.mockResolvedValue(okJson({ pluginassemblyid: "asm-new" }));
    const { context } = fakeDataverseContext();
    expect(await createDataversePluginAssembly(context, "Contoso.Plugins", "/tmp/a.dll")).toBe("asm-new");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("pluginassemblies");
    expect(options).toMatchObject({ method: "POST" });
    expect(JSON.parse((options as any).body)).toMatchObject({ name: "Contoso.Plugins", content: Buffer.from("DLLBYTES").toString("base64"), isolationmode: 2 });
  });
});

describe("ensure / upsert branching", () => {
  it("ensure returns the existing id without creating", async () => {
    fetchMock.mockResolvedValue(okJson({ value: [{ pluginassemblyid: "asm-existing" }] }));
    const { context } = fakeDataverseContext();
    expect(await ensureDataversePluginAssemblyId(context, "Contoso.Plugins", "/tmp/a.dll")).toEqual({ assemblyId: "asm-existing", created: false });
    expect(fetchMock).toHaveBeenCalledOnce(); // lookup only, no create
  });

  it("ensure creates when the assembly is missing", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [] })); // lookup: none
    fetchMock.mockResolvedValueOnce(okJson({ pluginassemblyid: "asm-created" })); // POST
    const { context } = fakeDataverseContext();
    expect(await ensureDataversePluginAssemblyId(context, "Contoso.Plugins", "/tmp/a.dll")).toEqual({ assemblyId: "asm-created", created: true });
  });

  it("upsert PATCHes content when the assembly already exists", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ value: [{ pluginassemblyid: "asm-existing" }] })); // lookup
    fetchMock.mockResolvedValueOnce(okJson({})); // PATCH
    const { context } = fakeDataverseContext();
    expect(await upsertDataversePluginAssembly(context, "Contoso.Plugins", "/tmp/a.dll")).toEqual({ assemblyId: "asm-existing", created: false, updated: true });
    const patch = fetchMock.mock.calls[1];
    expect(patch[0]).toContain("pluginassemblies(asm-existing)");
    expect(patch[1]).toMatchObject({ method: "PATCH" });
  });
});

describe("updateDataversePluginAssemblyContent", () => {
  it("returns false and logs guidance on a strong-name rejection", async () => {
    fetchMock.mockResolvedValue(httpError(400, "Bad Request", "0x8004416c public key token"));
    const { context, lines } = fakeDataverseContext();
    expect(await updateDataversePluginAssemblyContent(context, "asm-1", "/tmp/a.dll")).toBe(false);
    expect(lines.join("\n")).toContain("strong-named assembly");
  });
});
