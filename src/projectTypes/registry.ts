// Single source of truth for project types (#47, #100).
//
// This module is pure (no `vscode` import) so it can be unit-tested and later
// drive the menu view-model. Runtime wiring per type lives in ./activation.ts,
// keyed by the same enum so TypeScript enforces completeness. package.json
// contributions are static and can't read this registry, so registry.spec.ts
// enforces parity between the two — adding a project type means adding a
// descriptor + activation + templates folder + package.json entries, and CI
// fails until they all agree.

export enum ProjectTypes {
  plugin = "plugin",
  webresource = "webresources",
  solution = "solution",
  portal = "portal",
}

/** A button in the actions panel (#100). `command` is executed with `args` when clicked. */
export interface MenuAction {
  command: string;
  label: string;
  args?: unknown[];
}

/** Per-project state that varies which menu actions a type offers. */
export interface ProjectMenuState {
  templateVersion?: number;
  hasPluginUnitTesting?: boolean;
  hasSpkl?: boolean;
  /** Web resources: current build output mode (#88). */
  webresourceOutput?: "bundle" | "perFile";
}

/** The action set a project card renders (#100 v2): one call-to-action, a short
 * secondary row, everything else behind the ⋯ overflow. The primary label may
 * contain "{environment}" — replaced with the connected environment's name. */
export interface ProjectMenu {
  primary: MenuAction;
  secondary: MenuAction[];
  overflow: MenuAction[];
}

export interface ProjectTypeDescriptor {
  id: ProjectTypes;
  /** Label shown in the project-type quick pick and UI panels. */
  displayName: string;
  /** Folder under templates/ holding this type's template.json. */
  templateFolder: string;
  /** templateversion written to dataverse-powertools.json at project creation. */
  defaultTemplateVersion: number;
  /** when-clause context key (without the dataverse-powertools. prefix) gating this type's UI. */
  contextKey: string;
  /**
   * Commands owned by this type: everything its initialise path registers plus
   * any commands gated on its contextKey in package.json. Union across template
   * versions (legacy plugin included) — the parity test checks both directions.
   */
  commandIds: readonly string[];
  /** Actions the panel's project card shows for this type. Every command must be in commandIds. */
  menu(state: ProjectMenuState): ProjectMenu;
}

const prefix = "dataverse-powertools.";

export const projectTypeRegistry: readonly ProjectTypeDescriptor[] = [
  {
    id: ProjectTypes.plugin,
    displayName: "Plugins",
    templateFolder: "plugin",
    defaultTemplateVersion: 3,
    contextKey: "isPlugin",
    commandIds: [
      `${prefix}generateEarlyBound`,
      `${prefix}configurePluginEarlyBound`,
      `${prefix}buildAndDeploy`,
      `${prefix}buildDeployPlugin`,
      `${prefix}buildProject`,
      `${prefix}buildDeployWorkflow`,
      `${prefix}createPluginClass`,
      `${prefix}createWorkflowClass`,
      `${prefix}setupPluginUnitTesting`,
      `${prefix}runPluginTests`,
      `${prefix}createPluginTest`,
      `${prefix}createSNKKey`,
      `${prefix}addClassDecoration`,
      `${prefix}addPluginDecoration`,
      `${prefix}addWorkflowDecoration`,
      `${prefix}updateFilteringAttributes`,
      `${prefix}editModelBuilderSetting`,
      `${prefix}editPluginMessageFilter`,
      `${prefix}togglePluginEmitEntityEtc`,
      `${prefix}viewPluginTraceLogs`,
    ],
    menu(state) {
      const legacy = (state.templateVersion ?? 0) < 3;
      return {
        primary: { command: `${prefix}buildAndDeploy`, label: "Build & deploy package" },
        secondary: [
          { command: `${prefix}buildProject`, label: "Build" },
          state.hasPluginUnitTesting ? { command: `${prefix}runPluginTests`, label: "Tests" } : { command: `${prefix}setupPluginUnitTesting`, label: "Set up tests" },
          legacy ? { command: `${prefix}generateEarlyBound`, label: "Early bound" } : { command: `${prefix}configurePluginEarlyBound`, label: "Early bound" },
        ],
        overflow: [
          { command: `${prefix}createPluginClass`, label: "New plugin class" },
          { command: `${prefix}createWorkflowClass`, label: "New workflow class" },
          { command: `${prefix}viewPluginTraceLogs`, label: "View plugin trace logs" },
          ...(legacy
            ? [
                { command: `${prefix}createSNKKey`, label: "Create SNK key" },
                { command: `${prefix}addPluginDecoration`, label: "Add plugin decoration" },
                { command: `${prefix}addWorkflowDecoration`, label: "Add workflow decoration" },
              ]
            : [
                { command: `${prefix}createPluginTest`, label: "New plugin test" },
                { command: `${prefix}generateEarlyBound`, label: "Generate early bound" },
                { command: `${prefix}updateFilteringAttributes`, label: "Update filtering attributes" },
                { command: `${prefix}addClassDecoration`, label: "Add class decoration" },
              ]),
          { command: `${prefix}buildDeployWorkflow`, label: "Build & deploy workflow" },
        ],
      };
    },
  },
  {
    id: ProjectTypes.webresource,
    displayName: "Web Resources",
    templateFolder: "webresources",
    defaultTemplateVersion: 1,
    contextKey: "isWebResource",
    commandIds: [
      `${prefix}buildWebresources`,
      `${prefix}deployWebresources`,
      `${prefix}generateTypings`,
      `${prefix}createWebResourceClass`,
      `${prefix}createWebResourceTest`,
      `${prefix}addFormDecoration`,
      `${prefix}saveFormData`,
      `${prefix}upgradeFromSpkl`,
      `${prefix}debugWebresources`,
      `${prefix}stopDebugWebresources`,
      `${prefix}switchWebresourceOutput`,
    ],
    menu(state) {
      return {
        primary: { command: `${prefix}deployWebresources`, label: "Deploy to {environment}" },
        secondary: [
          { command: `${prefix}buildWebresources`, label: "Build" },
          { command: `${prefix}debugWebresources`, label: "Debug local" },
          { command: `${prefix}generateTypings`, label: "Typings" },
        ],
        // saveFormData has no menu entry: Deploy registers form events itself
        // (deploy-then-register is the only order that always works — #90). The
        // command stays for the palette and automation.
        overflow: [
          { command: `${prefix}createWebResourceClass`, label: "New class" },
          { command: `${prefix}createWebResourceTest`, label: "New test" },
          { command: `${prefix}addFormDecoration`, label: "Add form registration" },
          { command: `${prefix}switchWebresourceOutput`, label: `Output mode (${state.webresourceOutput === "perFile" ? "per-file" : "bundled"})…` },
          ...(state.hasSpkl ? [{ command: `${prefix}upgradeFromSpkl`, label: "Upgrade from Spkl" }] : []),
        ],
      };
    },
  },
  {
    id: ProjectTypes.solution,
    displayName: "Solution",
    templateFolder: "solution",
    defaultTemplateVersion: 1.1,
    contextKey: "isSolution",
    commandIds: [`${prefix}extractSolution`, `${prefix}packSolution`, `${prefix}deploySolution`],
    menu() {
      return {
        primary: { command: `${prefix}deploySolution`, label: "Deploy to {environment}" },
        secondary: [
          { command: `${prefix}extractSolution`, label: "Extract" },
          { command: `${prefix}packSolution`, label: "Pack" },
        ],
        overflow: [],
      };
    },
  },
  {
    id: ProjectTypes.portal,
    displayName: "Portal",
    templateFolder: "portal",
    defaultTemplateVersion: 1,
    contextKey: "isPortal",
    commandIds: [`${prefix}connectPortal`, `${prefix}downloadPortal`, `${prefix}uploadPortal`],
    menu() {
      return {
        primary: { command: `${prefix}downloadPortal`, label: "Download from {environment}" },
        secondary: [
          { command: `${prefix}uploadPortal`, label: "Upload" },
          { command: `${prefix}connectPortal`, label: "Select site" },
        ],
        overflow: [],
      };
    },
  },
];

export function getProjectTypeDescriptor(id: string | undefined): ProjectTypeDescriptor | undefined {
  return projectTypeRegistry.find((d) => d.id === id);
}

export function isSupportedProjectType(id: string | undefined): boolean {
  return getProjectTypeDescriptor(id) !== undefined;
}

/** templates/ subfolder for a type id, falling back to the raw id for unknown types
 * (matches the historical behaviour where the id doubled as the folder name). */
export function getTemplateFolderForType(id: string | undefined): string | undefined {
  if (id === undefined) {
    return undefined;
  }
  return getProjectTypeDescriptor(id)?.templateFolder ?? id;
}
