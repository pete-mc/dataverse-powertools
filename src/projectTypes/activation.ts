/* eslint-disable @typescript-eslint/naming-convention -- the `commands` map keys are literal command ids */
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { ProjectTypes, getProjectTypeDescriptor, projectTypeRegistry } from "./registry";
import { runForComponent } from "../components/componentDiscovery";
import { runTracked } from "../panel/operationTracker";
import { initialiseWebresources } from "../webresources/initialiseWebresources";
import { initialiseSolutions } from "../solution/initialiseSolutions";
import { initialisePortals } from "../portals/initialisePortals";
import { initialisePlugins } from "../plugins/initialisePlugins";
import { createPluginClass, createWorkflowClass } from "../plugins/createClasses";
import { openEarlyboundConfig } from "../plugins/pluginTables";
import { promptAndSetupPluginUnitTesting, runPluginUnitTests, createPluginTest } from "../plugins/unitTesting";
import { buildProject } from "../plugins/buildProject";
import { buildAndDeploy } from "../plugins/buildAndDeploy";
import { addClassDecoration, updateFilteringAttributes } from "../plugins/decorations";
import { viewPluginTraceLogs } from "../plugins/traceLogs";
import { downloadPluginProfiles } from "../plugins/downloadProfiles";
import { generateEarlyBoundV3, configureModelBuilderSettings } from "../general/modelbuilder";
import { initialisePlugins as initialisePluginsOld } from "../plugins_old/initialisePlugins";
import { pluginTableSelector as pluginTableSelectorOld } from "../plugins_old/pluginTables";
import { createSNKKey, generateEarlyBound as generateEarlyBoundOld } from "../plugins_old/earlybound";
import { buildProject as buildProjectOld } from "../plugins_old/buildPlugin";
import { buildDeployPlugin as buildDeployPluginOld } from "../plugins_old/buildDeployPlugin";
import { buildDeployWorkflow as buildDeployWorkflowOld } from "../plugins_old/buildDeployWorkflow";
import { createPluginClass as createPluginClassOld, createWorkflowClass as createWorkflowClassOld } from "../plugins_old/createPluginClass";
import { addPluginDecoration } from "../plugins_old/addStepDecoration";
import { addWorkflowDecoration } from "../plugins_old/addWorkflowDecoration";
import { generateTypings } from "../webresources/generateTypings";
import { buildWebresources } from "../webresources/buildWebresources";
import { deployWebresources } from "../webresources/deployWebresources";
import { createWebResourceClass, createWebResourceTest } from "../webresources/createWebresourceClass";
import { addFormDecoration } from "../webresources/addFormDecoration";
import { saveFormData } from "../webresources/saveFormData";
import { upgradeFromSpkl } from "../webresources/upgradeFromSpkl";
import { debugWebResources, stopDebugWebResources } from "../webresources/debug/debugWebresources";
import { switchWebresourceOutput } from "../webresources/switchOutputMode";
import { runWebresourceTests } from "../webresources/runTests";
import { openFormIntersects } from "../webresources/tableIntersects/tableIntersects";
import { extractSolution } from "../solution/extractSolution";
import { packSolution } from "../solution/packSolution";
import { deploySolution } from "../solution/deploySolution";
import { connectPortal } from "../portals/connectPortal";

type CommandImpl = (context: DataversePowerToolsContext, resourceUri?: vscode.Uri) => unknown;

/** Runtime wiring for a project type. Keyed by ProjectTypes so adding an enum
 * member fails compilation here until the new type is wired. */
export interface ProjectTypeActivation {
  /** Per-type setup run once per PRESENT type at activation: context keys,
   * template load, trees, test controllers, codelens, watchers. Command
   * registration does NOT belong here — commands register once, globally. */
  initialise(context: DataversePowerToolsContext): Promise<void> | void;
  /** Command implementations, registered ONCE at activation (#47): the handler
   * resolves which component the invocation targets (Explorer URI → owner;
   * one component of the type → it; several → quick-pick) and runs the impl
   * with a component-scoped context. */
  commands: Record<string, CommandImpl>;
  /** Runs during createNewProject after scaffolding/restore, before generalInitialise. */
  onProjectScaffolded?(context: DataversePowerToolsContext): Promise<void>;
  /** Runs during createNewProject after generalInitialise (per-type first-run steps). */
  onProjectCreated?(context: DataversePowerToolsContext): Promise<void>;
}

function isPluginV3(context: DataversePowerToolsContext): boolean {
  return context.projectSettings.templateversion === 3;
}

/** Route a plugin command to its v3 or legacy (template < 3) implementation. */
function pluginImpl(v3: CommandImpl, legacy: CommandImpl): CommandImpl {
  return (context, resourceUri) => (isPluginV3(context) ? v3(context, resourceUri) : legacy(context, resourceUri));
}

/** Label tracked operations with the component when it isn't the workspace root. */
function trackedLabel(context: DataversePowerToolsContext, label: string): string {
  const component = context.activeComponent;
  return component && !component.isRoot ? `${label} (${component.relativeRoot})` : label;
}

function tracked(label: string, run: (context: DataversePowerToolsContext) => Promise<unknown> | unknown): CommandImpl {
  return (context) => runTracked(context, trackedLabel(context, label), () => run(context));
}

function placeholderSnk(context: DataversePowerToolsContext): void {
  const message = "This template uses pac plugin init --skip-signing; SNK generation is not required by default.";
  context.channel.appendLine(`[Plugin Placeholder] ${message}`);
  vscode.window.showInformationMessage(message);
}

export const projectTypeActivations: Record<ProjectTypes, ProjectTypeActivation> = {
  [ProjectTypes.plugin]: {
    async initialise(context) {
      if (isPluginV3(context)) {
        await initialisePlugins(context);
        // The earlybound tree is NOT loaded here: one view can't represent several
        // plugin components, so "Configure Earlybound" on the project card opens
        // it on demand, scoped to the invoking component (#47).
      } else {
        // Policy (#71): legacy (<v3, spkl.exe-based, Windows-only) plugin support is
        // frozen — no new features — and will be REMOVED in 0.8.0. The migration
        // path is a new Plugins component (Add Component offers to move the existing
        // project into a subfolder first), then moving the plugin classes across —
        // the v3 layout (pac plugin init) is too different for a safe auto-rewrite.
        context.channel.appendLine("[Deprecated] Legacy plugin template (<v3) support is frozen and will be REMOVED in 0.8.0.");
        context.channel.appendLine(
          "[Deprecated] Migrate: run Add Component → Plugins (it offers to move this project into a subfolder first), then move your plugin classes into the new project.",
        );
        vscode.window.showWarningMessage(
          "This plugin project uses the legacy (<v3) template. Legacy support is frozen and will be removed in Dataverse PowerTools 0.8.0 — see the output for the migration path.",
        );
        await initialisePluginsOld(context);
        await pluginTableSelectorOld(context);
        // Legacy still loads its tree eagerly — reveal the view for it.
        await vscode.commands.executeCommand("setContext", "dataverse-powertools.earlyboundTreeLoaded", true);
      }
    },
    commands: {
      "dataverse-powertools.generateEarlyBound": pluginImpl(tracked("Generate early bound", generateEarlyBoundV3), tracked("Generate early bound", generateEarlyBoundOld)),
      "dataverse-powertools.configurePluginEarlyBound": (context) => configureModelBuilderSettings(context),
      "dataverse-powertools.openEarlyboundConfig": pluginImpl(
        (context) => openEarlyboundConfig(context),
        // Legacy loads its tree at initialise — just bring the view forward.
        () => vscode.commands.executeCommand("dataversePowerToolsTree.focus"),
      ),
      "dataverse-powertools.buildAndDeploy": pluginImpl(tracked("Build & deploy package", buildAndDeploy), tracked("Build & deploy package", buildDeployPluginOld)),
      "dataverse-powertools.buildDeployPlugin": pluginImpl(tracked("Build & deploy package", buildAndDeploy), tracked("Build & deploy package", buildDeployPluginOld)),
      "dataverse-powertools.buildProject": pluginImpl(tracked("Build", buildProject), tracked("Build", buildProjectOld)),
      "dataverse-powertools.buildDeployWorkflow": pluginImpl(tracked("Build & deploy workflow", buildAndDeploy), tracked("Build & deploy workflow", buildDeployWorkflowOld)),
      "dataverse-powertools.createPluginClass": pluginImpl(
        (context, uri) => createPluginClass(context, uri),
        (context) => createPluginClassOld(context),
      ),
      "dataverse-powertools.createWorkflowClass": pluginImpl(
        (context, uri) => createWorkflowClass(context, uri),
        (context) => createWorkflowClassOld(context),
      ),
      "dataverse-powertools.setupPluginUnitTesting": (context) => promptAndSetupPluginUnitTesting(context),
      "dataverse-powertools.runPluginTests": tracked("Tests", runPluginUnitTests),
      "dataverse-powertools.createPluginTest": (context, uri) => createPluginTest(context, uri),
      "dataverse-powertools.createSNKKey": pluginImpl(
        (context) => placeholderSnk(context),
        (context) => createSNKKey(context),
      ),
      "dataverse-powertools.addClassDecoration": (context) => addClassDecoration(context),
      "dataverse-powertools.addPluginDecoration": pluginImpl(
        (context) => addClassDecoration(context),
        (context) => addPluginDecoration(context),
      ),
      "dataverse-powertools.addWorkflowDecoration": pluginImpl(
        (context) => addClassDecoration(context),
        (context) => addWorkflowDecoration(context),
      ),
      "dataverse-powertools.updateFilteringAttributes": (context) => updateFilteringAttributes(context),
      "dataverse-powertools.viewPluginTraceLogs": (context) => viewPluginTraceLogs(context),
      // Profiles are org-side records — works for both template versions.
      "dataverse-powertools.downloadPluginProfiles": (context) => downloadPluginProfiles(context),
    },
    async onProjectScaffolded(context) {
      if (isPluginV3(context)) {
        await promptAndSetupPluginUnitTesting(context);
      }
    },
    async onProjectCreated(context) {
      if (isPluginV3(context)) {
        await initialisePlugins(context);
        context.channel.appendLine("Plugin project initialised using pac plugin init --skip-signing.");
        // The pac sample class is removed during layout normalisation — offer a
        // real one instead, mirroring the web-resources flow.
        vscode.window
          .showQuickPick(["Yes", "No"], {
            placeHolder: "Would you like to create a new plugin class?",
          })
          .then(async (value) => {
            if (value === "Yes") {
              await createPluginClass(context);
            }
          });
      } else {
        await createSNKKey(context);
        await generateEarlyBoundOld(context);
        await buildProjectOld(context);
        initialisePluginsOld(context);
      }
    },
  },
  [ProjectTypes.webresource]: {
    initialise: (context) => initialiseWebresources(context),
    async onProjectScaffolded(context) {
      // Output mode (#88): the webpack template reads this setting at build time.
      const pick = await vscode.window.showQuickPick(
        [
          { label: "Single bundled library (recommended)", description: "one <prefix>_library.js from library.ts", target: "bundle" as const },
          { label: "One file per web resource", description: "one <prefix>_<name>.js per webresources_src/*.ts", target: "perFile" as const },
        ],
        { placeHolder: "How should web resources be built?" },
      );
      context.projectSettings.webresourceOutput = pick?.target ?? "bundle";
      await context.writeSettings();
    },
    commands: {
      "dataverse-powertools.buildWebresources": tracked("Build", buildWebresources),
      "dataverse-powertools.deployWebresources": tracked("Deploy", deployWebresources),
      "dataverse-powertools.generateTypings": tracked("Generate typings", generateTypings),
      "dataverse-powertools.createWebResourceClass": (context) => createWebResourceClass(context),
      "dataverse-powertools.createWebResourceTest": (context) => createWebResourceTest(context),
      "dataverse-powertools.addFormDecoration": (context) => addFormDecoration(context),
      "dataverse-powertools.saveFormData": (context) => saveFormData(context),
      "dataverse-powertools.upgradeFromSpkl": (context) => upgradeFromSpkl(context),
      "dataverse-powertools.debugWebresources": (context) => debugWebResources(context),
      "dataverse-powertools.stopDebugWebresources": () => stopDebugWebResources(),
      "dataverse-powertools.switchWebresourceOutput": (context) => switchWebresourceOutput(context),
      "dataverse-powertools.runWebresourceTests": tracked("Tests", runWebresourceTests),
      "dataverse-powertools.openFormIntersects": (context) => openFormIntersects(context),
    },
    async onProjectCreated(context) {
      await generateTypings(context);
      initialiseWebresources(context);
      // ask if they want to create a new webresource
      vscode.window
        .showQuickPick(["Yes", "No"], {
          placeHolder: "Would you like to create a new webresource?",
        })
        .then(async (value) => {
          if (value === "Yes") {
            await createWebResourceClass(context);
          }
        });
    },
  },
  [ProjectTypes.solution]: {
    initialise: (context) => initialiseSolutions(context),
    commands: {
      "dataverse-powertools.extractSolution": tracked("Extract", extractSolution),
      "dataverse-powertools.packSolution": tracked("Pack", packSolution),
      "dataverse-powertools.deploySolution": tracked("Deploy", deploySolution),
    },
  },
  [ProjectTypes.portal]: {
    initialise: (context) => initialisePortals(context),
    commands: {
      "dataverse-powertools.connectPortal": tracked("Connect portal", (context) => connectPortal(context, "connect")),
      "dataverse-powertools.downloadPortal": tracked("Download portal", (context) => connectPortal(context, "download")),
      "dataverse-powertools.uploadPortal": tracked("Upload portal", (context) => connectPortal(context, "upload")),
    },
  },
};

export function getProjectTypeActivation(type: string | undefined): ProjectTypeActivation | undefined {
  const descriptor = getProjectTypeDescriptor(type);
  return descriptor ? projectTypeActivations[descriptor.id] : undefined;
}

/** Register EVERY project type's commands once at activation (#47). Handlers
 * resolve the target component per invocation, so multiple components — and
 * multiple types — coexist without double-registration collisions. */
export function registerAllComponentCommands(context: DataversePowerToolsContext): void {
  for (const descriptor of projectTypeRegistry) {
    const activation = projectTypeActivations[descriptor.id];
    for (const [commandId, impl] of Object.entries(activation.commands)) {
      context.vscode.subscriptions.push(
        vscode.commands.registerCommand(commandId, (hint?: vscode.Uri | string) =>
          runForComponent(context, descriptor.id, hint, (scoped) => impl(scoped, hint instanceof vscode.Uri ? hint : undefined)),
        ),
      );
    }
  }
}
