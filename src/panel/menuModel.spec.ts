import { describe, it, expect } from "vitest";
import { buildMenuModel, PanelState, ProjectCardState, ALLOWED_EXTERNAL_URLS, environmentName, sanitizeLayout, Card } from "./menuModel";
import { projectTypeRegistry } from "../projectTypes/registry";

function project(overrides: Partial<ProjectCardState> = {}): ProjectCardState {
  return {
    type: "plugin",
    name: "ContosoCore",
    relativeRoot: "",
    root: "c:/repo",
    isRoot: true,
    detail: "Contoso.Plugins.csproj",
    templateVersion: 3,
    hasPluginUnitTesting: false,
    hasSpkl: false,
    ...overrides,
  };
}

function state(overrides: Partial<PanelState> = {}): PanelState {
  return {
    detecting: false,
    loaded: true,
    projects: [project()],
    organizationUrl: "https://contoso.crm.dynamics.com",
    authType: "clientsecret",
    environmentLabel: undefined,
    connected: true,
    debugSessionActive: false,
    formRegistrations: [],
    activity: [],
    requirements: { scanning: false, scanned: true, dotnet: true, node: true, pac: true },
    ...overrides,
  };
}

function cardIds(s: PanelState): string[] {
  return buildMenuModel(s).cards.map((c) => c.id);
}

function card<K extends Card["kind"]>(s: PanelState, kind: K, id?: string): Extract<Card, { kind: K }> {
  const found = buildMenuModel(s).cards.find((c) => c.kind === kind && (id === undefined || c.id === id));
  if (!found) {
    throw new Error(`no ${kind} card${id ? ` (${id})` : ""}; got [${cardIds(s).join(", ")}]`);
  }
  return found as Extract<Card, { kind: K }>;
}

describe("environmentName", () => {
  it("takes the first host label", () => {
    expect(environmentName("https://contoso.crm.dynamics.com")).toBe("contoso");
    expect(environmentName("contoso-dev.crm4.dynamics.com")).toBe("contoso-dev");
    expect(environmentName(undefined)).toBe("environment");
  });
});

describe("pac in-flight banner (device-code sign-in)", () => {
  it("shows a busy notice at the top while a pac operation runs with no code yet", () => {
    const s = state({ pacOperation: { label: "Signing in to Power Platform CLI" } });
    const cards = buildMenuModel(s).cards;
    expect(cards[0].id).toBe("pacBusy");
    expect(cards[0].kind).toBe("notice");
    expect((cards[0] as { text: string; spinner?: boolean }).text).toBe("Signing in to Power Platform CLI…");
    expect((cards[0] as { spinner?: boolean }).spinner).toBe(true);
  });

  it("shows a prominent sign-in card (code + url) once the device code is known", () => {
    const s = state({
      pacOperation: { label: "Signing in to Power Platform CLI" },
      deviceCodeSignIn: { url: "https://microsoft.com/devicelogin", code: "ABCD-EFGH" },
    });
    const signin = card(s, "signin");
    expect(signin.code).toBe("ABCD-EFGH");
    expect(signin.url).toBe("https://microsoft.com/devicelogin");
    expect(signin.title).toBe("Signing in to Power Platform CLI");
    // It is the very first card — impossible to miss.
    expect(buildMenuModel(s).cards[0].id).toBe("signin");
  });

  it("prefers the sign-in card over the busy notice when both would apply", () => {
    const s = state({
      pacOperation: { label: "Signing in to Power Platform CLI" },
      deviceCodeSignIn: { url: "u", code: "X-Y" },
    });
    const ids = cardIds(s);
    expect(ids).toContain("signin");
    expect(ids).not.toContain("pacBusy");
  });

  it("renders the sign-in banner even before a project is loaded (top-level branch)", () => {
    const s = state({ loaded: false, projects: [], deviceCodeSignIn: { url: "u", code: "X-Y" } });
    expect(buildMenuModel(s).cards[0].id).toBe("signin");
  });

  it("has no banner when no pac operation is in flight", () => {
    expect(cardIds(state())).not.toContain("signin");
    expect(cardIds(state())).not.toContain("pacBusy");
  });
});

describe("top-level states", () => {
  it("shows only a spinner notice while folder settings load", () => {
    const model = buildMenuModel(state({ detecting: true }));
    expect(model.cards.map((c) => c.id)).toEqual(["detecting"]);
    expect((model.cards[0] as { spinner?: boolean }).spinner).toBe(true);
  });

  it("offers initialise + walkthrough + requirements when no project is loaded", () => {
    const s = state({ loaded: false, projects: [] });
    expect(cardIds(s)).toEqual(["getStarted", "requirements"]);
    const getStarted = card(s, "getStarted");
    expect(getStarted.actions.map((a) => a.command)).toEqual(["dataverse-powertools.initialiseProject", "workbench.action.openWalkthrough"]);
  });

  it("flags an unsupported project type instead of rendering a project card", () => {
    const model = buildMenuModel(state({ projects: [project({ type: "notarealtype" })] }));
    expect(model.cards[1].kind).toBe("notice");
    expect((model.cards[1] as { text: string }).text).toMatch(/not supported/);
  });
});

describe("environment card", () => {
  it("shows env name, auth label, connection state and switch/overflow actions", () => {
    const env = card(state({ authType: "oauth", connected: false }), "environment");
    expect(env.name).toBe("contoso");
    expect(env.authLabel).toBe("OAuth");
    expect(env.connected).toBe(false);
    expect(env.switchAction.command).toBe("dataverse-powertools.switchEnvironment");
    expect(env.overflow.map((a) => a.command)).not.toContain("dataverse-powertools.restoreDependencies");
  });

  it("renders the user-set environment tag", () => {
    expect(card(state({ environmentLabel: "dev" }), "environment").label).toBe("dev");
  });
});

describe("project cards", () => {
  it("substitutes {environment} into the primary action label", () => {
    const p = card(state({ projects: [project({ type: "webresources" })] }), "project");
    expect(p.primary.label).toBe("Deploy to contoso");
  });

  it("appends the component root to every card action's args (#47)", () => {
    const p = card(state(), "project");
    expect(p.primary.args).toEqual(["c:/repo"]);
    for (const action of [...p.secondary, ...p.overflow]) {
      expect(action.args?.[action.args.length - 1]).toBe("c:/repo");
    }
  });

  it("renders one card per component with the subfolder in the detail line", () => {
    const s = state({
      projects: [
        project({ type: "plugin", name: "core-plugins" }),
        project({ type: "webresources", name: "account-scripts", relativeRoot: "src/webresources", root: "c:/repo/src/webresources", isRoot: false, detail: undefined }),
      ],
    });
    const model = buildMenuModel(s);
    const projectCards = model.cards.filter((c) => c.kind === "project");
    expect(projectCards).toHaveLength(2);
    expect((projectCards[1] as { detail?: string }).detail).toBe("src/webresources");
    expect((projectCards[1] as { id: string }).id).toBe("project:webresources:src/webresources");
  });

  it("attributes the status line to the right component", () => {
    const s = state({
      projects: [project({ isRoot: true }), project({ type: "webresources", relativeRoot: "web", root: "c:/repo/web", isRoot: false })],
      activity: [
        { label: "Build", status: "error", time: "15:01", componentRoot: "c:/repo/web" },
        { label: "Deploy", status: "success", time: "14:32" },
      ],
    });
    const model = buildMenuModel(s);
    const [rootCard, webCard] = model.cards.filter((c) => c.kind === "project") as Extract<Card, { kind: "project" }>[];
    expect(rootCard.status).toEqual({ icon: "ok", text: "Deploy 14:32" });
    expect(webCard.status).toEqual({ icon: "error", text: "Build failed 15:01" });
  });

  it("plugin: tests vs set-up-tests follows unit-testing state", () => {
    const withTests = card(state({ projects: [project({ hasPluginUnitTesting: true })] }), "project");
    expect(withTests.secondary.map((a) => a.command)).toContain("dataverse-powertools.runPluginTests");
    const withoutTests = card(state({ projects: [project({ hasPluginUnitTesting: false })] }), "project");
    expect(withoutTests.secondary.map((a) => a.command)).toContain("dataverse-powertools.setupPluginUnitTesting");
  });

  it("puts Restore Dependencies in each project card overflow", () => {
    const p = card(state(), "project");
    expect(p.overflow.map((a) => a.command)).toContain("dataverse-powertools.restoreDependencies");
  });

  it("always offers Add Component when loaded", () => {
    const actions = card(state(), "actions", "addComponent");
    expect(actions.actions[0].command).toBe("dataverse-powertools.addComponent");
  });
});

describe("plug-in trace-log tag (#137)", () => {
  it("hides the tag until the level is known", () => {
    expect(card(state({ traceLog: undefined }), "environment").traceLog).toBeUndefined();
  });

  it("colours + labels the tag by level and wires the picker command", () => {
    const tag = card(state({ traceLog: 2 }), "environment").traceLog!;
    expect(tag.label).toBe("Trace: All");
    expect(tag.colour).toBe("red");
    expect(tag.action.command).toBe("dataverse-powertools.setTraceLogLevel");
    expect(card(state({ traceLog: 0 }), "environment").traceLog!.colour).toBe("green");
    expect(card(state({ traceLog: 1 }), "environment").traceLog!.colour).toBe("orange");
  });
});

describe("plugin debugging block (#63)", () => {
  // Plug-in debugging is a preview feature — the block only exists with the flag on.
  const pluginState = (over: Partial<ProjectCardState> = {}) => state({ projects: [project({ type: "plugin", ...over })], previewFeatures: true });

  it("embeds a Debugging block on plugin cards only", () => {
    expect(card(pluginState(), "project").debugging).toBeDefined();
    expect(card(state({ projects: [project({ type: "webresources", detail: undefined })], previewFeatures: true }), "project").debugging).toBeUndefined();
  });

  it("offers Capture + Download + Replay & debug + Generate, targeting the component", () => {
    const d = card(pluginState({ root: "c:/repo/plugins", isRoot: false, relativeRoot: "plugins" }), "project").debugging!;
    expect(d.capture.command).toBe("dataverse-powertools.capturePluginRun");
    expect(d.download.command).toBe("dataverse-powertools.downloadPluginProfiles");
    // "Replay & debug" now REPLAYS under the debugger; writing the test file is its own action, because
    // that is a different job (commit it, run it in CI) from debugging a captured run.
    expect(d.replay.command).toBe("dataverse-powertools.replayAndDebug");
    expect(d.replay.label).toBe("Replay & debug");
    expect(d.generate.command).toBe("dataverse-powertools.generatePluginReplayTest");
    expect(d.generate.label).toBe("Generate Replay Test");
    expect(d.capture.args).toContain("c:/repo/plugins");
    expect(d.generate.args).toContain("c:/repo/plugins");
  });

  it("reports the downloaded-profile count from the local scan", () => {
    expect(card(pluginState({ downloadedProfiles: 0 }), "project").debugging!.downloadedProfiles).toBe(0);
    expect(card(pluginState({ downloadedProfiles: 3 }), "project").debugging!.downloadedProfiles).toBe(3);
  });

  it("carries the org-wide active-profiles list onto the plugin card (#139)", () => {
    const rows = [{ label: "Acme.Plugin", detail: "Update · account", index: 0 }];
    const withProfiles = state({ projects: [project({ type: "plugin" })], activeProfiles: rows, previewFeatures: true });
    expect(card(withProfiles, "project").debugging!.activeProfiles).toEqual(rows);
    expect(card(pluginState(), "project").debugging!.activeProfiles).toEqual([]);
  });

  it("adds the profiling how-to to the plugin card overflow (#139)", () => {
    const overflow = card(pluginState(), "project").overflow.map((a) => a.command);
    expect(overflow).toContain("dataverse-powertools.guidePluginProfiling");
  });

  it("keeps the profiler commands out of the card overflow (they live in the block)", () => {
    const overflow = card(pluginState(), "project").overflow.map((a) => a.command);
    expect(overflow).not.toContain("dataverse-powertools.capturePluginRun");
    expect(overflow).not.toContain("dataverse-powertools.downloadPluginProfiles");
    expect(overflow).not.toContain("dataverse-powertools.generatePluginReplayTest");
  });
});

describe("preview-feature gating", () => {
  const pluginCard = (previewFeatures: boolean) => card(state({ projects: [project({ type: "plugin" })], previewFeatures }), "project");

  it("hides the plugin Debugging block until preview features are on", () => {
    expect(pluginCard(false).debugging).toBeUndefined();
    expect(pluginCard(true).debugging).toBeDefined();
  });

  it("hides the Custom API actions from the plugin overflow until preview features are on", () => {
    const customApi = /customApi|CustomApi/;
    expect(pluginCard(false).overflow.filter((a) => customApi.test(a.command))).toEqual([]);
    expect(pluginCard(true).overflow.filter((a) => customApi.test(a.command)).length).toBeGreaterThan(0);
    // Non-preview overflow items are untouched.
    expect(pluginCard(false).overflow.map((a) => a.command)).toContain("dataverse-powertools.createPluginClass");
  });

  it("hides Azure Function cards and says why, without touching the other components", () => {
    const projects = [
      project({ type: "plugin", relativeRoot: "plugins", root: "c:/repo/plugins", isRoot: false }),
      project({ type: "azurefunction", relativeRoot: "fn", root: "c:/repo/fn", isRoot: false }),
    ];
    const off = buildMenuModel(state({ projects, rootIsEmpty: true, previewFeatures: false }));
    expect(off.cards.filter((c) => c.kind === "project").map((c) => c.id)).toEqual(["project:plugin:plugins"]);
    const notice = off.cards.find((c) => c.kind === "notice" && c.id === "previewHidden") as { text: string };
    expect(notice.text).toContain("Azure Functions");

    const on = buildMenuModel(state({ projects, rootIsEmpty: true, previewFeatures: true }));
    expect(on.cards.filter((c) => c.kind === "project").map((c) => c.id)).toEqual(["project:plugin:plugins", "project:azurefunction:fn"]);
    expect(on.cards.find((c) => c.id === "previewHidden")).toBeUndefined();
  });

  it("keeps the empty-workspace notice for a workspace with no components at all", () => {
    const cards = buildMenuModel(state({ projects: [], rootIsEmpty: true })).cards;
    expect(cards.some((c) => c.id === "noComponents")).toBe(true);
    expect(cards.some((c) => c.id === "previewHidden")).toBe(false);
  });

  it("reports the flag to the footer so the checkbox mirrors the setting", () => {
    expect(buildMenuModel(state({ previewFeatures: true })).footer.preview).toEqual({ enabled: true, label: "Preview features" });
    expect(buildMenuModel(state()).footer.preview.enabled).toBe(false);
  });
});

describe("webresource extras", () => {
  const webState = (overrides: Partial<PanelState> = {}) => state({ projects: [project({ type: "webresources", detail: undefined })], ...overrides });

  it("embeds registrations in the webresource card with rows and the add action", () => {
    const s = webState({ formRegistrations: [{ label: "contoso.ContactForm.onLoad", detail: "onload", index: 0 }] });
    const registrations = card(s, "project").registrations!;
    expect(registrations.rows).toHaveLength(1);
    expect(registrations.add.command).toBe("dataverse-powertools.addFormDecoration");
    expect(registrations.note).toMatch(/deploy/i);
  });

  it("collapses registrations beyond the row cap into a +N note", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ label: `fn${i}`, detail: "onload", index: i }));
    const registrations = card(webState({ formRegistrations: rows }), "project").registrations!;
    expect(registrations.rows).toHaveLength(8);
    expect(registrations.note).toMatch(/\+3 more/);
  });

  it("gives each webresource card only ITS registrations, keyed by component root", () => {
    const s = state({
      projects: [
        project({ type: "webresources", relativeRoot: "web-a", root: "c:/repo/web-a", isRoot: false, detail: undefined }),
        project({ type: "webresources", relativeRoot: "web-b", root: "C:\\repo\\web-b", isRoot: false, detail: undefined }),
      ],
      formRegistrations: [
        { label: "a.onLoad", detail: "onload", index: 0, componentRoot: "c:/repo/web-a" },
        { label: "b.onLoad", detail: "onload", index: 1, componentRoot: "c:/repo/web-b" },
      ],
    });
    const [cardA, cardB] = buildMenuModel(s).cards.filter((c) => c.kind === "project") as Extract<Card, { kind: "project" }>[];
    expect(cardA.registrations?.rows.map((r) => r.label)).toEqual(["a.onLoad"]);
    // Roots compare normalized — backslashes/drive-letter casing don't split rows.
    expect(cardB.registrations?.rows.map((r) => r.label)).toEqual(["b.onLoad"]);
    expect(cardA.registrations?.add.args).toContain("c:/repo/web-a");
  });

  it("attaches legacy rootless registrations to any webresource card", () => {
    const registrations = card(webState({ formRegistrations: [{ label: "legacy.onLoad", detail: "onload", index: 0 }] }), "project").registrations!;
    expect(registrations.rows).toHaveLength(1);
  });

  it("puts no registrations on non-webresource cards", () => {
    expect(card(state(), "project").registrations).toBeUndefined();
  });

  it("shows the session card only while a debug session runs, webresources only", () => {
    expect(cardIds(webState({ debugSessionActive: true }))).toContain("session");
    expect(cardIds(webState({ debugSessionActive: false }))).not.toContain("session");
    expect(cardIds(state({ debugSessionActive: true }))).not.toContain("session");
  });

  it("offers no Register Form Events button anywhere — deploy subsumes it (#90)", () => {
    const model = buildMenuModel(webState({ projects: [project({ type: "webresources", hasSpkl: true, detail: undefined })] }));
    const allActions: string[] = [];
    for (const c of model.cards) {
      if (c.kind === "project") {
        allActions.push(c.primary.command, ...c.secondary.map((a) => a.command), ...c.overflow.map((a) => a.command));
        if (c.registrations) {
          allActions.push(c.registrations.add.command);
        }
      }
    }
    expect(allActions).not.toContain("dataverse-powertools.saveFormData");
  });
});

describe("activity + requirements placement", () => {
  it("adds an activity card when operations exist", () => {
    const items = [{ label: "Deploy", status: "success" as const, time: "14:32" }];
    expect(card(state({ activity: items }), "activity").items).toEqual(items);
    expect(cardIds(state())).not.toContain("activity");
  });

  it("collapses requirements into the footer when all green", () => {
    const model = buildMenuModel(state());
    expect(model.cards.map((c) => c.kind)).not.toContain("requirements");
    expect(model.footer.requirementsOk).toBe(true);
  });

  it("footer carries whitelisted Help & feedback links (#120)", () => {
    const model = buildMenuModel(state());
    expect(model.footer.help.map((l) => l.label)).toEqual(["Docs", "Report an issue"]);
    for (const link of model.footer.help) {
      expect(ALLOWED_EXTERNAL_URLS).toContain(link.url);
    }
  });

  it("surfaces the requirements card when something is missing", () => {
    const s = state({ requirements: { scanning: false, scanned: true, dotnet: true, node: true, pac: false } });
    const requirements = card(s, "requirements");
    expect(buildMenuModel(s).footer.requirementsOk).toBe(false);
    expect(requirements.rows.find((r) => r.id === "pac")?.ok).toBe(false);
    for (const row of requirements.rows) {
      expect(ALLOWED_EXTERNAL_URLS).toContain(row.downloadUrl);
    }
  });
});

describe("registry menu self-parity", () => {
  const menuStates = [
    { templateVersion: 3, hasPluginUnitTesting: true, hasSpkl: true },
    { templateVersion: 3, hasPluginUnitTesting: false, hasSpkl: false },
    { templateVersion: 2, hasPluginUnitTesting: true, hasSpkl: true },
    { templateVersion: 1, hasPluginUnitTesting: false, hasSpkl: false },
    { templateVersion: 1, hasPluginUnitTesting: false, hasSpkl: false, webresourceOutput: "perFile" as const },
  ];

  it("every menu action of every type is a command the type owns", () => {
    for (const d of projectTypeRegistry) {
      for (const s of menuStates) {
        const menu = d.menu(s);
        for (const action of [menu.primary, ...menu.secondary, ...menu.overflow]) {
          expect(d.commandIds, `${d.id}: menu action ${action.command} not in commandIds`).toContain(action.command);
          expect(action.label.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("every type renders a project card with a primary action", () => {
    for (const d of projectTypeRegistry) {
      // previewFeatures on so preview-only types (Azure Functions) are included.
      const p = card(state({ projects: [project({ type: d.id, templateVersion: d.defaultTemplateVersion, detail: undefined })], previewFeatures: true }), "project");
      expect(p.id).toBe(`project:${d.id}`);
      expect(p.primary.command.length).toBeGreaterThan(0);
      expect(p.typeLabel).toBe(d.displayName.toUpperCase());
    }
  });
});

describe("project layout (#118)", () => {
  const multi = (over: Partial<PanelState> = {}) =>
    state({
      projects: [
        project({ type: "plugin", relativeRoot: "plugins", root: "c:/repo/plugins", isRoot: false }),
        project({ type: "webresources", relativeRoot: "web", root: "c:/repo/web", isRoot: false }),
        project({ type: "solution", relativeRoot: "sol", root: "c:/repo/sol", isRoot: false }),
      ],
      rootIsEmpty: true,
      ...over,
    });
  const projectDnd = (cards: ReturnType<typeof buildMenuModel>["cards"]) => cards.filter((c) => c.kind === "project").map((c) => (c as { dndId: string }).dndId);
  const addCmd = (cards: ReturnType<typeof buildMenuModel>["cards"]) =>
    (cards.find((c) => c.kind === "actions" && c.id === "addComponent") as { actions: { command: string }[] }).actions[0].command;

  it("orders sub-project cards by layout.order (unlisted append)", () => {
    expect(projectDnd(buildMenuModel(multi({ layout: { order: ["web", "sol"] } })).cards)).toEqual(["web", "sol", "plugins"]);
  });

  it("emits a collapsible group card holding its member project cards", () => {
    const cards = buildMenuModel(multi({ layout: { order: ["web", "plugins", "sol"], groups: [{ name: "Backend", members: ["plugins", "sol"], collapsed: true }] } })).cards;
    const group = cards.find((c) => c.kind === "group") as { name: string; collapsed: boolean; projects: { dndId: string }[] };
    expect(group.name).toBe("Backend");
    expect(group.collapsed).toBe(true);
    expect(group.projects.map((p) => p.dndId)).toEqual(["plugins", "sol"]);
    // The grouped members are not also emitted as top-level project cards.
    expect(projectDnd(cards)).toEqual(["web"]);
  });

  it("gates Add Component to Empty roots; a typed root offers convert", () => {
    expect(addCmd(buildMenuModel(multi({ rootIsEmpty: true })).cards)).toBe("dataverse-powertools.addComponent");
    expect(addCmd(buildMenuModel(multi({ rootIsEmpty: false })).cards)).toBe("dataverse-powertools.convertToComponentsWorkspace");
  });
});

describe("sanitizeLayout (#118 untrusted webview input)", () => {
  it("keeps well-formed order + groups + collapsedCards", () => {
    expect(sanitizeLayout({ order: ["a", "b"], groups: [{ name: "G", members: ["a"], collapsed: true }], collapsedCards: ["b"] })).toEqual({
      order: ["a", "b"],
      groups: [{ name: "G", members: ["a"], collapsed: true }],
      collapsedCards: ["b"],
    });
  });

  it("keeps only string ids in collapsedCards (#156, untrusted)", () => {
    expect(sanitizeLayout({ collapsedCards: ["a", 3, null, "b"] }).collapsedCards).toEqual(["a", "b"]);
    expect(sanitizeLayout({ collapsedCards: "nope" }).collapsedCards).toEqual([]);
  });

  it("drops non-strings, nameless/empty groups, and caps the name", () => {
    const out = sanitizeLayout({ order: ["a", 3, null], groups: [{ name: "", members: ["a"] }, { name: "G", members: [] }, { name: "H", members: ["x", 5] }, 7] });
    expect(out.order).toEqual(["a"]);
    expect(out.groups).toEqual([{ name: "H", members: ["x"], collapsed: false }]);
  });

  it("tolerates junk", () => {
    expect(sanitizeLayout(undefined)).toEqual({ order: [], groups: [], collapsedCards: [] });
    expect(sanitizeLayout("nope")).toEqual({ order: [], groups: [], collapsedCards: [] });
    expect(sanitizeLayout({ order: "x" }).order).toEqual([]);
  });
});

describe("card minimise default (#156)", () => {
  const webState = (over: Partial<PanelState> = {}): PanelState =>
    state({
      loaded: true,
      projects: [project({ type: "webresources", relativeRoot: "web1", isRoot: false }), project({ type: "plugin", relativeRoot: "plugin1", isRoot: false })],
      ...over,
    });
  const projectCards = (s: PanelState) => buildMenuModel(s).cards.filter((c) => c.kind === "project") as Extract<Card, { kind: "project" }>[];

  it("a workspace at the collapse threshold defaults all component cards to collapsed", () => {
    const collapsed = projectCards(webState({ collapseByDefault: true })).map((c) => c.collapsed);
    expect(collapsed).toEqual([true, true]);
  });

  it("a workspace below the threshold shows cards expanded", () => {
    const collapsed = projectCards(webState({ collapseByDefault: false })).map((c) => c.collapsed);
    expect(collapsed).toEqual([false, false]);
  });

  it("collapsedCards overrides the default per card (collapsed → expand one; expanded → collapse one)", () => {
    // Default collapsed; overriding web1 expands just it.
    let cards = projectCards(webState({ collapseByDefault: true, layout: { collapsedCards: ["web1"] } }));
    expect(cards.map((c) => [c.dndId, c.collapsed])).toEqual([
      ["web1", false],
      ["plugin1", true],
    ]);
    // Default expanded; overriding web1 collapses just it.
    cards = projectCards(webState({ collapseByDefault: false, layout: { collapsedCards: ["web1"] } }));
    expect(cards.map((c) => [c.dndId, c.collapsed])).toEqual([
      ["web1", true],
      ["plugin1", false],
    ]);
  });

  it("exposes collapseByDefault on the model for the webview override maths", () => {
    expect(buildMenuModel(webState({ collapseByDefault: true })).collapseByDefault).toBe(true);
    expect(buildMenuModel(webState({ collapseByDefault: false })).collapseByDefault).toBe(false);
  });
});
