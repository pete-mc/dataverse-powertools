import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { projectTypeRegistry, ProjectMenuState, ProjectTypeDescriptor } from "./registry";

// #80's leftovers, absorbed by #143: per-project-type MENU coverage (solution and portal in
// particular, which no end-to-end suite exercises), welcome-view `when`-clause gating, and the
// tree views' own gating.
//
// All three are static-contract problems, so they belong here rather than in a Selenium suite: the
// failure mode is a button or a view that silently never appears — the UI shows nothing, no error is
// raised anywhere, and only a human looking for a missing button notices. A `when` clause naming a
// context key nothing sets is indistinguishable, at runtime, from a feature legitimately hidden.
//
// VS Code exposes no API to read a context key's VALUE back, which is why an integration test can't
// cover this and why the check is "every key referenced is a key the extension sets".

const repoRoot = path.resolve(__dirname, "..", "..");
const packageJsonRaw = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
const packageJson = JSON.parse(packageJsonRaw);
const contributedIds: Set<string> = new Set(packageJson.contributes.commands.map((c: { command: string }) => c.command));

/** Every context key the extension actually sets, scraped from the setContext calls in src. */
function contextKeysSetByExtension(): Set<string> {
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "test" && entry.name !== "ui-test") {
          walk(full);
        }
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
        for (const match of fs.readFileSync(full, "utf8").matchAll(/setContext",\s*"dataverse-powertools\.([A-Za-z0-9]+)"/g)) {
          keys.add(match[1]);
        }
      }
    }
  };
  walk(path.join(repoRoot, "src"));
  return keys;
}

/** Context keys referenced by a `when` expression. */
function referencedContextKeys(expression: string): string[] {
  return [...expression.matchAll(/dataverse-powertools\.([A-Za-z0-9]+)/g)].map((m) => m[1]);
}

const SET_KEYS = contextKeysSetByExtension();
const declaredViewIds = new Set(Object.values(packageJson.contributes.views as Record<string, { id: string }[]>).flatMap((views) => views.map((v) => v.id)));

// A card's menu depends on the component's state, so checking one state would leave the branches
// that only appear for a legacy project, or once unit testing is set up, entirely unchecked — and
// those branches are where a stale command id survives longest, because nobody's daily workflow
// reaches them.
const MENU_STATES: Array<{ label: string; state: ProjectMenuState }> = [
  { label: "defaults", state: {} },
  { label: "legacy template", state: { templateVersion: 1, hasSpkl: true } },
  { label: "current template", state: { templateVersion: 3 } },
  { label: "unit testing set up", state: { templateVersion: 3, hasPluginUnitTesting: true } },
  { label: "per-file web resources", state: { webresourceOutput: "perFile" } },
  { label: "bundled web resources", state: { webresourceOutput: "bundle" } },
  { label: "http-triggered function", state: { azureFunctionTrigger: "http" } },
  { label: "webhook function", state: { azureFunctionTrigger: "webhook" } },
];

const actionsOf = (menu: ReturnType<ProjectTypeDescriptor["menu"]>) => [menu.primary, ...(menu.secondary ?? []), ...(menu.overflow ?? [])].filter(Boolean);

describe("project type menus — every button leads somewhere", () => {
  // A card button whose command the descriptor doesn't own is never registered, so clicking it
  // fails with "command not found" (as editPluginMessageFilter did). This covers every type at
  // once, including solution and portal, which have no end-to-end suite of their own.
  it("every menu command, in every card state, is owned by its descriptor and contributed", () => {
    for (const descriptor of projectTypeRegistry) {
      for (const { label, state } of MENU_STATES) {
        const actions = actionsOf(descriptor.menu(state));
        expect(actions.length, `${descriptor.id} (${label}): menu has no actions at all`).toBeGreaterThan(0);

        for (const action of actions) {
          expect(descriptor.commandIds, `${descriptor.id} (${label}): menu offers ${action.command}, which the descriptor does not own`).toContain(action.command);
          expect(contributedIds.has(action.command), `${descriptor.id} (${label}): menu offers ${action.command}, which package.json does not contribute`).toBe(true);
        }
      }
    }
  });

  it("every menu action carries a non-empty label", () => {
    for (const descriptor of projectTypeRegistry) {
      for (const { label, state } of MENU_STATES) {
        for (const action of actionsOf(descriptor.menu(state))) {
          expect(action.label?.trim(), `${descriptor.id} (${label}): ${action.command} has no label`).toBeTruthy();
        }
      }
    }
  });

  // The primary action is the button a user reaches for; repeating it in the same card's secondary
  // row or overflow gives two controls that do the same thing.
  it("no card repeats its primary action elsewhere in the same menu", () => {
    for (const descriptor of projectTypeRegistry) {
      for (const { label, state } of MENU_STATES) {
        const menu = descriptor.menu(state);
        const others = [...(menu.secondary ?? []), ...(menu.overflow ?? [])].map((a) => a.command);
        expect(others, `${descriptor.id} (${label}): primary ${menu.primary.command} repeated in its own menu`).not.toContain(menu.primary.command);
      }
    }
  });

  it("each type has its own primary action, so no two cards lead with the same button", () => {
    const primaries = new Map<string, string>();
    for (const descriptor of projectTypeRegistry) {
      const command = descriptor.menu({}).primary.command;
      const existing = primaries.get(command);
      expect(existing, `${descriptor.id} and ${existing} share the primary command ${command}`).toBeUndefined();
      primaries.set(command, descriptor.id);
    }
  });

  // Named explicitly because #80 called these out: no e2e suite drives them, so this is the only
  // place their action sets are described at all.
  it("solution offers deploy/extract/pack and portal offers download/upload/select-site/build", () => {
    const commandsFor = (id: string) => actionsOf(projectTypeRegistry.find((d) => d.id === id)!.menu({})).map((a) => a.command);

    expect(commandsFor("solution")).toEqual(
      expect.arrayContaining(["dataverse-powertools.deploySolution", "dataverse-powertools.extractSolution", "dataverse-powertools.packSolution"]),
    );
    expect(commandsFor("portal")).toEqual(
      expect.arrayContaining([
        "dataverse-powertools.downloadPortal",
        "dataverse-powertools.uploadPortal",
        "dataverse-powertools.connectPortal",
        "dataverse-powertools.buildPortal",
      ]),
    );
  });
});

describe("welcome-view gating", () => {
  const welcomeViews: { view: string; when?: string; contents: string }[] = packageJson.contributes.viewsWelcome;

  it("attaches every welcome view to a view that exists", () => {
    for (const welcome of welcomeViews) {
      expect(declaredViewIds.has(welcome.view), `viewsWelcome targets '${welcome.view}', which contributes.views does not declare`).toBe(true);
    }
  });

  // The silent failure this exists for: rename a context key in the code and the welcome view's
  // condition can never become true again. Nothing errors — the view is simply always empty.
  it("gates only on context keys the extension actually sets", () => {
    for (const welcome of welcomeViews) {
      for (const key of referencedContextKeys(welcome.when ?? "")) {
        expect(SET_KEYS.has(key), `viewsWelcome for '${welcome.view}' gates on dataverse-powertools.${key}, which no setContext call ever sets`).toBe(true);
      }
    }
  });

  it("gives every welcome view a condition — an ungated one shows over real content", () => {
    for (const welcome of welcomeViews) {
      expect(welcome.when?.trim(), `viewsWelcome for '${welcome.view}' has no when clause`).toBeTruthy();
    }
  });
});

describe("tree-view gating", () => {
  const views: { id: string; when?: string; name: string }[] = packageJson.contributes.views["dataverse-powertools"];

  // Both trees are created on demand (#47: one tree can't represent several components), so each
  // is hidden until its command sets the loaded key. A key nothing sets means a tree that never
  // appears no matter how many times the user runs the command that should open it.
  it("hides each on-demand tree behind a context key the extension sets", () => {
    for (const view of views.filter((v) => v.id !== "dataversePowerToolsMenu")) {
      expect(view.when?.trim(), `view '${view.id}' has no when clause — it would always be visible`).toBeTruthy();
      for (const key of referencedContextKeys(view.when!)) {
        expect(SET_KEYS.has(key), `view '${view.id}' gates on dataverse-powertools.${key}, which no setContext call ever sets`).toBe(true);
      }
    }
  });

  it("keeps the always-present Actions panel ungated", () => {
    const actions = views.find((v) => v.id === "dataversePowerToolsMenu");
    expect(actions?.when, "the Actions webview is the extension's entry point and must never be gated").toBeUndefined();
  });

  // Every view menu entry must be gated to its own view, or its inline button appears on items in
  // an unrelated tree and fails when clicked.
  it("scopes every view menu entry to a declared view", () => {
    const menus: Record<string, { command: string; when?: string }[]> = packageJson.contributes.menus ?? {};
    const viewMenuEntries = [...(menus["view/item/context"] ?? []), ...(menus["view/title"] ?? [])];
    expect(viewMenuEntries.length, "no view menu entries found — this check would be vacuous").toBeGreaterThan(0);

    for (const item of viewMenuEntries) {
      expect(item.when, `${item.command} has no when clause — it would show in every view`).toBeTruthy();
      const viewMatch = /view == ([A-Za-z]+)/.exec(item.when!);
      expect(viewMatch, `${item.command} is not scoped with 'view == <id>'`).not.toBeNull();
      expect(declaredViewIds.has(viewMatch![1]), `${item.command} is scoped to '${viewMatch![1]}', which is not a declared view`).toBe(true);
      expect(contributedIds.has(item.command) || item.command.startsWith("dataversePowerTools"), `${item.command} is not a contributed command`).toBe(true);
    }
  });

  // The tree CRUD buttons (add/remove form intersect, edit a model-builder setting) are shown by
  // `viewItem == <contextValue>`. Those strings are set in the TreeItem constructors, so a rename
  // on either side silently removes the button — the tree still renders, the actions just aren't
  // there. This is the only thing that pins the two halves together.
  it("shows tree CRUD buttons only for contextValues the trees actually set", () => {
    const menus: Record<string, { command: string; when?: string }[]> = packageJson.contributes.menus ?? {};
    const viewItemValues = new Set(
      [...(menus["view/item/context"] ?? []), ...(menus["view/title"] ?? [])].flatMap((item) => [...(item.when ?? "").matchAll(/viewItem == ([A-Za-z]+)/g)].map((m) => m[1])),
    );
    expect(viewItemValues.size, "no viewItem gating found — this check would be vacuous").toBeGreaterThan(0);

    // contextValue literals from the two tree providers.
    const treeSources = ["webresources/tableIntersects/tableIntersects.ts", "plugins/pluginTables.ts"]
      .map((file) => fs.readFileSync(path.join(repoRoot, "src", file), "utf8"))
      .join("\n");
    for (const value of viewItemValues) {
      expect(treeSources.includes(`"${value}"`), `package.json gates a tree button on viewItem == ${value}, which no tree item sets as its contextValue`).toBe(true);
    }
  });
});
