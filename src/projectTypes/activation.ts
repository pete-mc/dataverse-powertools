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
import { newCustomApi, generateCustomApiHandlers, generateCustomApiClients } from "../customapi/customApiCommands";
import { deployCustomApis } from "../customapi/deployCustomApi";
import { invokeCustomApi } from "../customapi/invokeCustomApi";
import { downloadPluginProfiles } from "../plugins/downloadProfiles";
import { capturePluginRun } from "../plugins/profilerCapture";
import { generatePluginReplayTest } from "../plugins/replayTest";
import { replayAndDebug } from "../plugins/replayDebug";
import { guidePluginProfiling } from "../plugins/profilerGuide";
import { generateEarlyBoundV3, configureModelBuilderSettings } from "../general/modelbuilder";
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
import { refreshConfigFiles } from "../general/configRefresh";
import { extractSolution } from "../solution/extractSolution";
import { packSolution } from "../solution/packSolution";
import { deploySolution } from "../solution/deploySolution";
import { connectPortal } from "../portals/connectPortal";
import { buildPortal } from "../portals/buildPortalCommand";
import { initialisePcf } from "../pcf/initialisePcf";
import { buildPcf } from "../pcf/buildPcf";
import { pushPcf } from "../pcf/pushPcf";
import { deployPcf } from "../pcf/deployPcf";
import { refreshPcfTypes } from "../pcf/refreshPcfTypes";
import { addPcfServiceLayer } from "../pcf/addServiceLayer";
import { runPcfHarness } from "../pcf/runHarness";
import { debugPcfLiveForm, stopPcfLiveDebug } from "../pcf/debug/debugPcfLiveForm";
import { initialiseAzureFunction } from "../azurefunction/initialiseAzureFunction";
import { buildAzureFunction } from "../azurefunction/buildAzureFunction";
import { registerWebhookStep } from "../azurefunction/registerWebhookStep";
import { generateAzureFunctionEarlyBound } from "../azurefunction/generateAzureFunctionEarlyBound";
import { deployAzureFunctionGuide } from "../azurefunction/deployAzureFunctionGuide";
import { publishAzureFunctionToAzure, startAzureFunctionHost } from "../azurefunction/funcCommands";
import { sendTestContext } from "../azurefunction/sendTestContext";
import { promptAndScaffoldTrigger } from "../azurefunction/scaffoldTrigger";

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
  /** Runs after a component is added via Add Component (#126), once it's scaffolded,
   * restored and initialised — the first-create niceties the standalone create flow gets
   * (e.g. generate typings, offer to create a class). Best-effort: the component already
   * exists, so a failure here doesn't fail Add Component. */
  onComponentAdded?(context: DataversePowerToolsContext): Promise<void>;
}

/** The current plugin template. Legacy (<v3, spkl.exe-based) projects were removed in 1.0.3 (#228);
 *  this now only decides whether to show the migration notice and the v3-only earlybound surfaces. */
function isPluginV3(context: DataversePowerToolsContext): boolean {
  return context.projectSettings.templateversion === 3;
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
        // The legacy (<v3, spkl.exe-based, Windows-only) plugin path was REMOVED in 1.0.3 (#228) —
        // six minor versions after #71's promised 0.9.0. The notice stays for a release or two because
        // it carries the migration path: a new Plugins component (Add Component offers to move this
        // project into a subfolder first), then move the plugin classes across. The v3 layout
        // (pac plugin init) is too different for a safe auto-rewrite.
        const upgradeWiki = "https://github.com/pete-mc/dataverse-powertools/wiki/Upgrading-Projects";
        context.channel.appendLine("[Deprecated] This project uses the legacy plugin template (<v3), whose support was REMOVED in 1.0.3.");
        context.channel.appendLine(
          "[Deprecated] Migrate: run Add Component → Plugins (it offers to move this project into a subfolder first), then move your plugin classes into the new project.",
        );
        context.channel.appendLine(`[Deprecated] Full upgrade guide (per-version differences, config refresh steps): ${upgradeWiki}`);
        vscode.window
          .showWarningMessage("This plugin project uses the legacy (<v3) template, whose support was removed in Dataverse PowerTools 1.0.3.", "How to upgrade")
          .then((choice) => {
            if (choice === "How to upgrade") {
              void vscode.env.openExternal(vscode.Uri.parse(upgradeWiki));
            }
          });
        // Best-effort: every command now has one (v3) implementation, so initialise that path anyway
        // rather than leave an inert card. A legacy layout may make it unhappy — never fail activation.
        try {
          await initialisePlugins(context);
        } catch (error) {
          context.channel.appendLine(`[Deprecated] Could not initialise the legacy project with the current plugin path: ${error}`);
        }
      }
    },
    commands: {
      "dataverse-powertools.generateEarlyBound": tracked("Generate early bound", generateEarlyBoundV3),
      "dataverse-powertools.configurePluginEarlyBound": (context) => configureModelBuilderSettings(context),
      "dataverse-powertools.openEarlyboundConfig": (context) => openEarlyboundConfig(context),
      "dataverse-powertools.buildAndDeploy": tracked("Build & deploy package", buildAndDeploy),
      "dataverse-powertools.buildDeployPlugin": tracked("Build & deploy package", buildAndDeploy),
      "dataverse-powertools.buildProject": tracked("Build", buildProject),
      "dataverse-powertools.buildDeployWorkflow": tracked("Build & deploy workflow", buildAndDeploy),
      "dataverse-powertools.createPluginClass": (context, uri) => createPluginClass(context, uri),
      "dataverse-powertools.createWorkflowClass": (context, uri) => createWorkflowClass(context, uri),
      "dataverse-powertools.setupPluginUnitTesting": (context) => promptAndSetupPluginUnitTesting(context),
      "dataverse-powertools.runPluginTests": tracked("Tests", runPluginUnitTests),
      "dataverse-powertools.createPluginTest": (context, uri) => createPluginTest(context, uri),
      "dataverse-powertools.createSNKKey": (context) => placeholderSnk(context),
      "dataverse-powertools.addClassDecoration": (context) => addClassDecoration(context),
      "dataverse-powertools.addPluginDecoration": (context) => addClassDecoration(context),
      "dataverse-powertools.addWorkflowDecoration": (context) => addClassDecoration(context),
      "dataverse-powertools.updateFilteringAttributes": (context) => updateFilteringAttributes(context),
      "dataverse-powertools.viewPluginTraceLogs": (context) => viewPluginTraceLogs(context),
      // Profiles are org-side records — works for both template versions.
      "dataverse-powertools.downloadPluginProfiles": (context) => downloadPluginProfiles(context),
      "dataverse-powertools.capturePluginRun": (context) => capturePluginRun(context),
      "dataverse-powertools.generatePluginReplayTest": (context) => generatePluginReplayTest(context),
      // Tracked: it runs a build + a test host, so it belongs in the activity feed like the other
      // long-running operations — and its outcome is now judged from what it reported (#229).
      "dataverse-powertools.replayAndDebug": tracked("Replay & debug", replayAndDebug),
      "dataverse-powertools.guidePluginProfiling": (context) => guidePluginProfiling(context),
      // Custom API definition-as-code (#142) — plugin-scoped.
      "dataverse-powertools.newCustomApi": (context) => newCustomApi(context),
      "dataverse-powertools.generateCustomApiHandlers": (context) => generateCustomApiHandlers(context),
      "dataverse-powertools.generateCustomApiClients": (context) => generateCustomApiClients(context),
      "dataverse-powertools.deployCustomApis": (context) => deployCustomApis(context),
      "dataverse-powertools.invokeCustomApi": (context) => invokeCustomApi(context),
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
            ignoreFocusOut: true, // a focus flap (e.g. the unit-testing toast) must not silently cancel the offer
          })
          .then(async (value) => {
            if (value === "Yes") {
              await createPluginClass(context);
            }
          });
      }
      // No legacy arm: a newly created project always uses the current template (#228).
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
      "dataverse-powertools.refreshConfigFiles": (context) => refreshConfigFiles(context),
    },
    async onProjectCreated(context) {
      await generateTypings(context);
      initialiseWebresources(context);
      // ask if they want to create a new webresource
      vscode.window
        .showQuickPick(["Yes", "No"], {
          placeHolder: "Would you like to create a new webresource?",
          ignoreFocusOut: true, // a focus flap must not silently cancel the offer
        })
        .then(async (value) => {
          if (value === "Yes") {
            await createWebResourceClass(context);
          }
        });
    },
    async onComponentAdded(context) {
      // First-create onboarding for a Web Resources component added via Add Component
      // (#126): generate typings, then offer to create a class — the same niceties the
      // standalone create flow (onProjectCreated) gives. initialiseWebresources already ran
      // via initialise(). Typings is best-effort (needs a live connection).
      try {
        await generateTypings(context);
      } catch (error) {
        context.channel.appendLine(`[Add Component] Generate typings skipped (non-fatal): ${error}`);
      }
      // Offer via a NON-blocking notification (fire-and-forget): a quick pick would block
      // adding further components. The user can ignore it and add more.
      void vscode.window.showInformationMessage("Web Resources component added. Create a web resource class?", "Create class").then(async (choice) => {
        if (choice === "Create class") {
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
      "dataverse-powertools.buildPortal": (context) => buildPortal(context),
    },
  },
  [ProjectTypes.pcf]: {
    initialise: (context) => initialisePcf(context),
    commands: {
      "dataverse-powertools.buildPcf": tracked("Build", buildPcf),
      "dataverse-powertools.pushPcf": tracked("Push", pushPcf),
      "dataverse-powertools.deployPcf": tracked("Add to solution", deployPcf),
      "dataverse-powertools.refreshPcfTypes": (context) => refreshPcfTypes(context),
      "dataverse-powertools.addPcfServiceLayer": (context) => addPcfServiceLayer(context),
      "dataverse-powertools.runPcfHarness": (context) => runPcfHarness(context),
      "dataverse-powertools.debugPcfLiveForm": (context) => debugPcfLiveForm(context),
      "dataverse-powertools.stopPcfLiveDebug": () => stopPcfLiveDebug(),
    },
  },
  [ProjectTypes.azurefunction]: {
    initialise: (context) => initialiseAzureFunction(context),
    commands: {
      "dataverse-powertools.buildAzureFunction": tracked("Build", buildAzureFunction),
      "dataverse-powertools.registerWebhookStep": tracked("Register webhook & step", registerWebhookStep),
      "dataverse-powertools.generateAzureFunctionEarlyBound": tracked("Generate early bound", generateAzureFunctionEarlyBound),
      "dataverse-powertools.deployAzureFunctionGuide": (context) => deployAzureFunctionGuide(context),
      "dataverse-powertools.publishAzureFunction": (context) => publishAzureFunctionToAzure(context),
      "dataverse-powertools.startAzureFunctionHost": (context) => startAzureFunctionHost(context),
      "dataverse-powertools.sendTestContext": (context) => sendTestContext(context),
    },
    // A function component isn't necessarily a Dataverse webhook (#145) — ask how it's
    // triggered and scaffold only that sample handler. The template ships the shared
    // infrastructure (typed RemoteExecutionContext, ServiceClient factory); the handler
    // is written here so the choice decides which one you get.
    async onProjectScaffolded(context) {
      await promptAndScaffoldTrigger(context);
    },
    async onComponentAdded(context) {
      await promptAndScaffoldTrigger(context);
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
