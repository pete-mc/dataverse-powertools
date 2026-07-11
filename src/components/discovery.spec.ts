import { describe, it, expect } from "vitest";
import { resolveComponents, componentForPath, componentsOfType, normalizeFsPath } from "./discovery";

const root = "C:\\repo";
const file = (path: string, settings: object) => ({ path, content: JSON.stringify(settings) });

describe("resolveComponents", () => {
  it("treats today's single root settings file as the one root component", () => {
    const { components, malformed } = resolveComponents(root, [
      file("C:\\repo\\dataverse-powertools.json", { type: "plugin", connectionString: "AuthType=OAuth;Url=https://x.crm.dynamics.com" }),
    ]);
    expect(malformed).toEqual([]);
    expect(components).toHaveLength(1);
    expect(components[0].isRoot).toBe(true);
    expect(components[0].relativeRoot).toBe("");
    expect(components[0].settings.type).toBe("plugin");
  });

  it("discovers subfolder components and orders root-first then by depth/name", () => {
    const { components } = resolveComponents(root, [
      file("C:\\repo\\src\\webresources\\dataverse-powertools.json", { type: "webresources" }),
      file("C:\\repo\\dataverse-powertools.json", { connectionString: "cs" }),
      file("C:\\repo\\plugins\\dataverse-powertools.json", { type: "plugin" }),
    ]);
    expect(components.map((c) => c.relativeRoot)).toEqual(["", "plugins", "src/webresources"]);
  });

  it("inherits the root connection (and companions) into subfolder components without one", () => {
    const { components } = resolveComponents(root, [
      file("C:\\repo\\dataverse-powertools.json", { connectionString: "root-cs", tenantId: "t-1", prefix: "ctso", environmentLabel: "DEV" }),
      file("C:\\repo\\plugins\\dataverse-powertools.json", { type: "plugin" }),
      file("C:\\repo\\other\\dataverse-powertools.json", { type: "webresources", connectionString: "own-cs", prefix: "own" }),
    ]);
    const inherited = components.find((c) => c.relativeRoot === "plugins")!;
    expect(inherited.settings.connectionString).toBe("root-cs");
    expect(inherited.settings.tenantId).toBe("t-1");
    expect(inherited.settings.prefix).toBe("ctso");
    expect(inherited.settings.environmentLabel).toBe("DEV");
    // Self-contained component keeps its own values untouched.
    const selfContained = components.find((c) => c.relativeRoot === "other")!;
    expect(selfContained.settings.connectionString).toBe("own-cs");
    expect(selfContained.settings.prefix).toBe("own");
  });

  it("reports malformed settings files without dropping the rest", () => {
    const { components, malformed } = resolveComponents(root, [
      { path: "C:\\repo\\bad\\dataverse-powertools.json", content: "{ not json" },
      file("C:\\repo\\dataverse-powertools.json", { type: "solution" }),
    ]);
    expect(components).toHaveLength(1);
    expect(malformed).toEqual(["C:\\repo\\bad\\dataverse-powertools.json"]);
  });

  it("ignores settings files outside the workspace root", () => {
    const { components } = resolveComponents(root, [file("C:\\elsewhere\\dataverse-powertools.json", { type: "plugin" })]);
    expect(components).toEqual([]);
  });

  it("does not treat a sibling folder with a shared prefix as inside the workspace", () => {
    const { components } = resolveComponents(root, [file("C:\\repo-other\\dataverse-powertools.json", { type: "plugin" })]);
    expect(components).toEqual([]);
  });
});

describe("componentForPath", () => {
  const { components } = resolveComponents(root, [
    file("C:\\repo\\dataverse-powertools.json", { type: "solution", connectionString: "cs" }),
    file("C:\\repo\\plugins\\dataverse-powertools.json", { type: "plugin" }),
    file("C:\\repo\\plugins\\nested\\dataverse-powertools.json", { type: "webresources" }),
  ]);

  it("resolves by longest matching component root", () => {
    expect(componentForPath(components, "C:\\repo\\plugins\\nested\\src\\a.ts")?.relativeRoot).toBe("plugins/nested");
    expect(componentForPath(components, "C:\\repo\\plugins\\MyPlugin.cs")?.relativeRoot).toBe("plugins");
    expect(componentForPath(components, "C:\\repo\\spkl.json")?.relativeRoot).toBe("");
  });

  it("returns undefined outside every component", () => {
    expect(componentForPath(components, "C:\\other\\x.ts")).toBeUndefined();
  });

  it("does not match a sibling folder sharing a name prefix", () => {
    expect(componentForPath(components, "C:\\repo\\pluginsX\\a.cs")?.relativeRoot).toBe("");
  });
});

describe("componentsOfType + normalizeFsPath", () => {
  it("filters by registry type id", () => {
    const { components } = resolveComponents(root, [
      file("C:\\repo\\a\\dataverse-powertools.json", { type: "plugin" }),
      file("C:\\repo\\b\\dataverse-powertools.json", { type: "plugin" }),
      file("C:\\repo\\c\\dataverse-powertools.json", { type: "webresources" }),
    ]);
    expect(componentsOfType(components, "plugin").map((c) => c.relativeRoot)).toEqual(["a", "b"]);
  });

  it("normalises separators, trailing slashes and drive-letter case", () => {
    expect(normalizeFsPath("C:\\Repo\\Sub\\")).toBe("c:/Repo/Sub");
    expect(normalizeFsPath("/home/user/repo/")).toBe("/home/user/repo");
  });
});
