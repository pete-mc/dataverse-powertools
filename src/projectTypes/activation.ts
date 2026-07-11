import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { ProjectTypes, getProjectTypeDescriptor } from "./registry";
import { initialiseWebresources } from "../webresources/initialiseWebresources";
import { initialiseSolutions } from "../solution/initialiseSolutions";
import { initialisePortals } from "../portals/initialisePortals";
import { initialisePlugins } from "../plugins/initialisePlugins";
import { createPluginClass } from "../plugins/createClasses";
import { pluginTableSelector as pluginTableSelectorV3 } from "../plugins/pluginTables";
import { promptAndSetupPluginUnitTesting } from "../plugins/unitTesting";
import { initialisePlugins as initialisePluginsOld } from "../plugins_old/initialisePlugins";
import { pluginTableSelector as pluginTableSelectorOld } from "../plugins_old/pluginTables";
import { createSNKKey, generateEarlyBound } from "../plugins_old/earlybound";
import { buildProject as buildProjectOld } from "../plugins_old/buildPlugin";
import { generateTypings } from "../webresources/generateTypings";
import { createWebResourceClass } from "../webresources/createWebresourceClass";

/** Runtime wiring for a project type. Keyed by ProjectTypes so adding an enum
 * member fails compilation here until the new type is wired. */
export interface ProjectTypeActivation {
  /** Activation-time setup: context keys, command registration, trees, test controllers. */
  initialise(context: DataversePowerToolsContext): Promise<void> | void;
  /** Runs during createNewProject after scaffolding/restore, before generalInitialise. */
  onProjectScaffolded?(context: DataversePowerToolsContext): Promise<void>;
  /** Runs during createNewProject after generalInitialise (per-type first-run steps). */
  onProjectCreated?(context: DataversePowerToolsContext): Promise<void>;
}

function isPluginV3(context: DataversePowerToolsContext): boolean {
  return context.projectSettings.templateversion === 3;
}

export const projectTypeActivations: Record<ProjectTypes, ProjectTypeActivation> = {
  [ProjectTypes.plugin]: {
    async initialise(context) {
      if (isPluginV3(context)) {
        await initialisePlugins(context);
        await pluginTableSelectorV3(context);
      } else {
        context.channel.appendLine("[Deprecated] Plugin template version 2 is deprecated.");
        context.channel.appendLine("[Deprecated] Please create a new Plugin project and manually migrate your plugin code to the new structure.");
        await initialisePluginsOld(context);
        await pluginTableSelectorOld(context);
      }
    },
    async onProjectScaffolded(context) {
      if (isPluginV3(context)) {
        await promptAndSetupPluginUnitTesting(context);
      }
    },
    async onProjectCreated(context) {
      if (isPluginV3(context)) {
        await initialisePlugins(context);
        // Register the early-bound settings tree provider now, mirroring activation
        // (extension.ts initialise). Without this the side panel shows "error
        // loading" for a freshly created project until VS Code is reloaded.
        await pluginTableSelectorV3(context);
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
        await generateEarlyBound(context);
        await buildProjectOld(context);
        initialisePluginsOld(context);
      }
    },
  },
  [ProjectTypes.webresource]: {
    initialise: (context) => initialiseWebresources(context),
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
  },
  [ProjectTypes.portal]: {
    initialise: (context) => initialisePortals(context),
  },
};

export function getProjectTypeActivation(type: string | undefined): ProjectTypeActivation | undefined {
  const descriptor = getProjectTypeDescriptor(type);
  return descriptor ? projectTypeActivations[descriptor.id] : undefined;
}
