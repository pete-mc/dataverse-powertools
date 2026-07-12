import { describe, it, expect } from "vitest";
import { buildMenuModel, PanelState, ProjectCardState, ALLOWED_EXTERNAL_URLS, environmentName, Card } from "./menuModel";
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
    const model = buildMenuModel(state({ projects: [project({ type: "pcf" })] }));
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

describe("webresource extras", () => {
  const webState = (overrides: Partial<PanelState> = {}) => state({ projects: [project({ type: "webresources", detail: undefined })], ...overrides });

  it("shows the registrations card with rows and the add action", () => {
    const s = webState({ formRegistrations: [{ label: "contoso.ContactForm.onLoad", detail: "onload", index: 0 }] });
    const registrations = card(s, "registrations");
    expect(registrations.rows).toHaveLength(1);
    expect(registrations.add.command).toBe("dataverse-powertools.addFormDecoration");
    expect(registrations.note).toMatch(/deploy/i);
  });

  it("collapses registrations beyond the row cap into a +N note", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ label: `fn${i}`, detail: "onload", index: i }));
    const registrations = card(webState({ formRegistrations: rows }), "registrations");
    expect(registrations.rows).toHaveLength(8);
    expect(registrations.note).toMatch(/\+3 more/);
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
      }
      if (c.kind === "registrations") {
        allActions.push(c.add.command);
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
      const p = card(state({ projects: [project({ type: d.id, templateVersion: d.defaultTemplateVersion, detail: undefined })] }), "project");
      expect(p.id).toBe(`project:${d.id}`);
      expect(p.primary.command.length).toBeGreaterThan(0);
      expect(p.typeLabel).toBe(d.displayName.toUpperCase());
    }
  });
});
