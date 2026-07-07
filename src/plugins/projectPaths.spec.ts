import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { isTestProjectPath, findPrimaryPluginCsproj, walkDirectory } from "./projectPaths";

describe("isTestProjectPath", () => {
  it("treats *.Tests.csproj as a test project", () => {
    expect(isTestProjectPath("C:/repo/Plugin.Tests/Plugin.Tests.csproj")).toBe(true);
  });

  it("treats a project inside a Tests folder as a test project", () => {
    expect(isTestProjectPath("/repo/tests/MyPlugin.csproj")).toBe(true);
    expect(isTestProjectPath("C:\\repo\\Tests\\MyPlugin.csproj")).toBe(true);
  });

  it("treats a normal plugin project as a non-test project", () => {
    expect(isTestProjectPath("C:/repo/Plugin/Plugin.csproj")).toBe(false);
  });
});

describe("findPrimaryPluginCsproj", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  function makeTree(files: string[]): string {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-paths-"));
    for (const rel of files) {
      const full = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, "<Project/>");
    }
    return tmp;
  }

  it("returns undefined when there are no csproj files", async () => {
    const root = makeTree(["src/readme.txt"]);
    expect(await findPrimaryPluginCsproj(root)).toBeUndefined();
  });

  it("ignores test projects and returns the plugin project", async () => {
    const root = makeTree(["Plugin/Plugin.csproj", "Plugin.Tests/Plugin.Tests.csproj"]);
    const result = await findPrimaryPluginCsproj(root);
    expect(result?.toLowerCase().endsWith("plugin.csproj")).toBe(true);
    expect(result?.toLowerCase().includes(".tests")).toBe(false);
  });

  it("prefers a project matching the preferred name", async () => {
    const root = makeTree(["A/Alpha.csproj", "B/Beta.csproj"]);
    const result = await findPrimaryPluginCsproj(root, "Beta");
    expect(path.basename(result ?? "")).toBe("Beta.csproj");
  });

  it("skips bin/obj/node_modules while walking", async () => {
    const root = makeTree(["Plugin/Plugin.csproj", "Plugin/obj/Debug/Generated.csproj", "node_modules/pkg/Some.csproj"]);
    const all = await walkDirectory(root);
    expect(all.some((f) => f.includes("obj"))).toBe(false);
    expect(all.some((f) => f.includes("node_modules"))).toBe(false);
    expect(all.some((f) => f.endsWith("Plugin.csproj"))).toBe(true);
  });
});
