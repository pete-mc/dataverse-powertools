import { describe, it, expect } from "vitest";
import {
  resolveComponents,
  componentForPath,
  componentsOfType,
  componentsToInitialise,
  normalizeFsPath,
  resolveTargetComponent,
  applyLayout,
  scopedTestControllerId,
  DiscoveredComponent,
} from "./discovery";

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
    // The inherited fields are recorded so writeSettings can strip them (not bake them
    // into the component's file, which would make it self-contained — #47).
    expect(inherited.inheritedFields).toEqual(["connectionString", "tenantId", "prefix", "environmentLabel"]);
    // Self-contained component keeps its own values untouched and inherits nothing.
    const selfContained = components.find((c) => c.relativeRoot === "other")!;
    expect(selfContained.settings.connectionString).toBe("own-cs");
    expect(selfContained.settings.prefix).toBe("own");
    expect(selfContained.inheritedFields).toBeUndefined();
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

describe("resolveTargetComponent (#119 command target)", () => {
  // Two plugin components + one web-resource, so "several of type" is exercised.
  const components = resolveComponents(root, [
    file("C:\\repo\\dataverse-powertools.json", { connectionString: "cs" }),
    file("C:\\repo\\pluginA\\dataverse-powertools.json", { type: "plugin" }),
    file("C:\\repo\\pluginB\\dataverse-powertools.json", { type: "plugin" }),
    file("C:\\repo\\web\\dataverse-powertools.json", { type: "webresources" }),
  ]).components;
  const rootOf = (r: string) => (components.find((c) => c.relativeRoot === r) as DiscoveredComponent).root;
  const resolvedRoot = (res: ReturnType<typeof resolveTargetComponent>) => (res.kind === "resolved" ? res.component.relativeRoot : res.kind);

  it("an explicit resource hint wins (the file's owning component)", () => {
    expect(resolvedRoot(resolveTargetComponent(components, "plugin", "C:\\repo\\pluginB\\Foo.cs", undefined))).toBe("pluginB");
  });

  it("a panel-card hint names a component root exactly", () => {
    expect(resolvedRoot(resolveTargetComponent(components, "plugin", rootOf("pluginA"), undefined))).toBe("pluginA");
  });

  it("auto-selects the only component of the type (no hint, single)", () => {
    expect(resolvedRoot(resolveTargetComponent(components, "webresources", undefined, undefined))).toBe("web");
  });

  it("infers from the active editor when several match and no hint", () => {
    expect(resolvedRoot(resolveTargetComponent(components, "plugin", undefined, "C:\\repo\\pluginA\\src\\Bar.cs"))).toBe("pluginA");
    expect(resolvedRoot(resolveTargetComponent(components, "plugin", undefined, "C:\\repo\\pluginB\\Baz.cs"))).toBe("pluginB");
  });

  it("asks (pick) when several match and the active file is the wrong type or absent", () => {
    expect(resolveTargetComponent(components, "plugin", undefined, "C:\\repo\\web\\lib.ts").kind).toBe("pick");
    expect(resolveTargetComponent(components, "plugin", undefined, undefined).kind).toBe("pick");
    expect(resolveTargetComponent(components, "plugin", undefined, "C:\\elsewhere\\x.cs").kind).toBe("pick");
  });

  it("does not use active-editor inference when an explicit (but wrong-type) hint was given", () => {
    // hint points at a web-resource file, command is plugin, active editor is pluginA:
    // the explicit hint suppresses inference → pick among the plugins.
    expect(resolveTargetComponent(components, "plugin", "C:\\repo\\web\\lib.ts", "C:\\repo\\pluginA\\Bar.cs").kind).toBe("pick");
  });

  it("returns none when no component of the type exists", () => {
    expect(resolveTargetComponent(components, "solution", undefined, undefined).kind).toBe("none");
  });

  it("pick candidates are exactly the components of the type", () => {
    const res = resolveTargetComponent(components, "plugin", undefined, undefined);
    expect(res.kind === "pick" && res.candidates.map((c) => c.relativeRoot)).toEqual(["pluginA", "pluginB"]);
  });
});

describe("componentsToInitialise (#146 per-component init on load)", () => {
  it("returns EVERY typed component — both of each type — not just the first", () => {
    const { components } = resolveComponents(root, [
      file("C:\\repo\\dataverse-powertools.json", { connectionString: "cs" }), // connection-only root, no type
      file("C:\\repo\\web1\\dataverse-powertools.json", { type: "webresources" }),
      file("C:\\repo\\web2\\dataverse-powertools.json", { type: "webresources" }),
      file("C:\\repo\\plugin1\\dataverse-powertools.json", { type: "plugin" }),
      file("C:\\repo\\plugin2\\dataverse-powertools.json", { type: "plugin" }),
    ]);
    // The bug (#146): the old loop initialised only the first of each type, so web2/plugin2
    // never got a Test Explorer controller on load. This must list all four.
    expect(componentsToInitialise(components).map((c) => c.relativeRoot)).toEqual(["plugin1", "plugin2", "web1", "web2"]);
  });

  it("excludes the connection-only root and unsupported/unknown types", () => {
    const { components } = resolveComponents(root, [
      file("C:\\repo\\dataverse-powertools.json", { connectionString: "cs" }),
      file("C:\\repo\\mystery\\dataverse-powertools.json", { type: "not-a-real-type" }),
      file("C:\\repo\\plugin\\dataverse-powertools.json", { type: "plugin" }),
    ]);
    expect(componentsToInitialise(components).map((c) => c.relativeRoot)).toEqual(["plugin"]);
  });

  it("returns the single root component for a legacy single-project workspace", () => {
    const { components } = resolveComponents(root, [file("C:\\repo\\dataverse-powertools.json", { type: "webresources", connectionString: "cs" })]);
    const toInit = componentsToInitialise(components);
    expect(toInit).toHaveLength(1);
    expect(toInit[0].isRoot).toBe(true);
  });
});

describe("scopedTestControllerId (#84/#47 duplicate-controller guard)", () => {
  const components = resolveComponents(root, [
    file("C:\\repo\\dataverse-powertools.json", { connectionString: "cs" }),
    file("C:\\repo\\web\\dataverse-powertools.json", { type: "webresources" }),
    file("C:\\repo\\web2\\dataverse-powertools.json", { type: "webresources" }),
  ]).components;

  it("gives two same-type components DISTINCT ids (no VS Code duplicate-controller crash)", () => {
    const [a, b] = componentsOfType(components, "webresources");
    const idA = scopedTestControllerId("dataverse-powertools.webresourceTests", a.root, a.isRoot);
    const idB = scopedTestControllerId("dataverse-powertools.webresourceTests", b.root, b.isRoot);
    expect(idA).not.toEqual(idB);
    expect(idA).toBe("dataverse-powertools.webresourceTests::c:/repo/web");
    expect(idB).toBe("dataverse-powertools.webresourceTests::c:/repo/web2");
  });

  it("keeps the bare id for the root component (single-project behaviour unchanged)", () => {
    expect(scopedTestControllerId("dataverse-powertools.pluginTests", "C:\\repo", true)).toBe("dataverse-powertools.pluginTests");
    expect(scopedTestControllerId("dataverse-powertools.pluginTests", undefined, false)).toBe("dataverse-powertools.pluginTests");
  });

  it("is stable across re-inits of the same component (same root → same id)", () => {
    expect(scopedTestControllerId("x", "C:\\repo\\web", false)).toBe(scopedTestControllerId("x", "c:/repo/web/", false));
  });
});

describe("applyLayout (#118 sidebar arrangement)", () => {
  const components = resolveComponents(root, [
    file("C:\\repo\\dataverse-powertools.json", { connectionString: "cs" }),
    file("C:\\repo\\plugins\\dataverse-powertools.json", { type: "plugin" }),
    file("C:\\repo\\web\\dataverse-powertools.json", { type: "webresources" }),
    file("C:\\repo\\solution\\dataverse-powertools.json", { type: "solution" }),
  ]).components;
  const shape = (rows: ReturnType<typeof applyLayout>) =>
    rows.map((r) => (r.kind === "component" ? r.component.relativeRoot : `[${r.name}:${r.components.map((c) => c.relativeRoot).join(",")}${r.collapsed ? " ×" : ""}]`));

  it("excludes the root and keeps discovery order with no layout", () => {
    expect(shape(applyLayout(components, undefined))).toEqual(["plugins", "solution", "web"]);
  });

  it("orders by layout.order, appending unlisted in discovery order", () => {
    expect(shape(applyLayout(components, { order: ["solution", "plugins"] }))).toEqual(["solution", "plugins", "web"]);
  });

  it("emits a group at its first member's position with all members nested", () => {
    const rows = applyLayout(components, { order: ["web", "plugins", "solution"], groups: [{ name: "Backend", members: ["plugins", "solution"] }] });
    expect(shape(rows)).toEqual(["web", "[Backend:plugins,solution]"]);
  });

  it("carries the collapsed flag and honours member order within a group", () => {
    const rows = applyLayout(components, { order: ["solution", "plugins", "web"], groups: [{ name: "G", members: ["plugins", "solution"], collapsed: true }] });
    expect(shape(rows)).toEqual(["[G:solution,plugins ×]", "web"]);
  });

  it("ignores stale layout entries and a member listed in two groups (first wins)", () => {
    const rows = applyLayout(components, {
      order: ["plugins", "gone"],
      groups: [
        { name: "A", members: ["plugins"] },
        { name: "B", members: ["plugins", "web"] },
      ],
    });
    expect(shape(rows)).toEqual(["[A:plugins]", "solution", "[B:web]"]);
  });
});
