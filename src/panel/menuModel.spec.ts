import { describe, it, expect } from "vitest";
import { buildMenuModel, PanelState, ALLOWED_EXTERNAL_URLS, environmentName, Card } from "./menuModel";
import { projectTypeRegistry } from "../projectTypes/registry";

function state(overrides: Partial<PanelState> = {}): PanelState {
  return {
    detecting: false,
    loaded: true,
    projectType: "plugin",
    projectName: "ContosoCore",
    projectDetail: "Contoso.Plugins.csproj",
    templateVersion: 3,
    hasPluginUnitTesting: false,
    hasSpkl: false,
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

function card<K extends Card["kind"]>(s: PanelState, kind: K): Extract<Card, { kind: K }> {
  const found = buildMenuModel(s).cards.find((c) => c.kind === kind);
  if (!found) {
    throw new Error(`no ${kind} card; got [${cardIds(s).join(", ")}]`);
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
  it("shows only a detecting notice while folder settings load", () => {
    const model = buildMenuModel(state({ detecting: true }));
    expect(model.cards.map((c) => c.id)).toEqual(["detecting"]);
  });

  it("offers initialise + walkthrough + requirements when no project is loaded", () => {
    const s = state({ loaded: false, projectType: undefined });
    expect(cardIds(s)).toEqual(["getStarted", "requirements"]);
    const getStarted = card(s, "getStarted");
    expect(getStarted.actions.map((a) => a.command)).toEqual(["dataverse-powertools.initialiseProject", "workbench.action.openWalkthrough"]);
  });

  it("flags an unsupported project type instead of rendering a project card", () => {
    const model = buildMenuModel(state({ projectType: "pcf" }));
    expect(model.cards[1].kind).toBe("notice");
    expect((model.cards[1] as { text: string }).text).toMatch(/not supported/);
  });
});

describe("environment card", () => {
  it("shows env name, auth label, connection state and switch/overflow actions", () => {
    const env = card(state({ authType: "oauth", connected: false }), "environment");
    expect(env.name).toBe("contoso");
    expect(env.url).toBe("contoso.crm.dynamics.com");
    expect(env.authLabel).toBe("OAuth");
    expect(env.connected).toBe(false);
    expect(env.switchAction.command).toBe("dataverse-powertools.switchEnvironment");
    // Restore Dependencies is a project action, not a connection action (manual-testing feedback).
    expect(env.overflow.map((a) => a.command)).not.toContain("dataverse-powertools.restoreDependencies");
  });

  it("puts Restore Dependencies in the project card overflow", () => {
    const project = card(state(), "project");
    expect(project.overflow.map((a) => a.command)).toContain("dataverse-powertools.restoreDependencies");
  });

  it("renders the user-set environment tag", () => {
    expect(card(state({ environmentLabel: "dev" }), "environment").label).toBe("dev");
    expect(card(state(), "environment").label).toBeUndefined();
  });
});

describe("project card", () => {
  it("substitutes {environment} into the primary action label", () => {
    const project = card(state({ projectType: "webresources" }), "project");
    expect(project.primary.label).toBe("Deploy to contoso");
    expect(project.primary.command).toBe("dataverse-powertools.deployWebresources");
  });

  it("plugin: tests vs set-up-tests follows unit-testing state", () => {
    const withTests = card(state({ hasPluginUnitTesting: true }), "project");
    expect(withTests.secondary.map((a) => a.command)).toContain("dataverse-powertools.runPluginTests");
    const withoutTests = card(state({ hasPluginUnitTesting: false }), "project");
    expect(withoutTests.secondary.map((a) => a.command)).toContain("dataverse-powertools.setupPluginUnitTesting");
  });

  it("derives its status line from the latest activity", () => {
    const running = card(state({ activity: [{ label: "Deploy", status: "running", time: "" }] }), "project");
    expect(running.status).toEqual({ icon: "running", text: "Deploy…" });
    const failed = card(state({ activity: [{ label: "Build", status: "error", time: "15:01" }] }), "project");
    expect(failed.status).toEqual({ icon: "error", text: "Build failed 15:01" });
    const ok = card(state({ activity: [{ label: "Deploy", status: "success", time: "14:32" }] }), "project");
    expect(ok.status).toEqual({ icon: "ok", text: "Deploy 14:32" });
    expect(card(state(), "project").status).toBeUndefined();
  });
});

describe("webresource extras", () => {
  it("shows the registrations card with rows and the add action", () => {
    const s = state({ projectType: "webresources", formRegistrations: [{ label: "account · Main Form", detail: "3 forms" }] });
    const registrations = card(s, "registrations");
    expect(registrations.rows).toHaveLength(1);
    expect(registrations.add.command).toBe("dataverse-powertools.addFormDecoration");
    expect(registrations.note).toMatch(/deploy/i);
  });

  it("offers no Register Form Events button anywhere — deploy subsumes it (#90)", () => {
    const s = state({ projectType: "webresources", hasSpkl: true });
    const model = buildMenuModel(s);
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

  it("shows the session card only while a debug session runs, webresources only", () => {
    expect(cardIds(state({ projectType: "webresources", debugSessionActive: true }))).toContain("session");
    expect(cardIds(state({ projectType: "webresources", debugSessionActive: false }))).not.toContain("session");
    expect(cardIds(state({ projectType: "plugin", debugSessionActive: true }))).not.toContain("session");
    const session = card(state({ projectType: "webresources", debugSessionActive: true }), "session");
    expect(session.stop.command).toBe("dataverse-powertools.stopDebugWebresources");
  });

  it("plugin projects get no registrations card", () => {
    expect(cardIds(state({ projectType: "plugin" }))).not.toContain("registrations");
  });
});

describe("activity + requirements placement", () => {
  it("adds an activity card when operations exist", () => {
    const items = [
      { label: "Deploy", status: "success" as const, time: "14:32" },
      { label: "Build", status: "error" as const, time: "13:05", detail: "tsc failed" },
    ];
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

  it("marks rows pending while scanning", () => {
    const s = state({ requirements: { scanning: true, scanned: false, dotnet: false, node: false, pac: false } });
    const requirements = card(s, "requirements");
    expect(requirements.scanning).toBe(true);
    expect(requirements.rows.every((r) => r.ok === undefined)).toBe(true);
    expect(requirements.recheck).toBeUndefined();
  });
});

describe("registry menu self-parity", () => {
  const menuStates = [
    { templateVersion: 3, hasPluginUnitTesting: true, hasSpkl: true },
    { templateVersion: 3, hasPluginUnitTesting: false, hasSpkl: false },
    { templateVersion: 2, hasPluginUnitTesting: true, hasSpkl: true },
    { templateVersion: 1, hasPluginUnitTesting: false, hasSpkl: false },
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
      const project = card(state({ projectType: d.id, templateVersion: d.defaultTemplateVersion }), "project");
      expect(project.id).toBe(`project:${d.id}`);
      expect(project.primary.command.length).toBeGreaterThan(0);
      expect(project.typeLabel).toBe(d.displayName.toUpperCase());
    }
  });
});
