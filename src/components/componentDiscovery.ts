import * as vscode from "vscode";
import fs = require("fs");
import DataversePowerToolsContext from "../context";
import { resolveComponents, componentForPath, componentsOfType, DiscoveredComponent, normalizeFsPath } from "./discovery";
import { fsMigrationIo } from "../general/migrationIo";
import { ProjectTypes } from "../projectTypes/registry";

// vscode-side wrapper over the pure discovery (#47 phase 3): find every
// dataverse-powertools.json in the workspace, resolve into components, and
// expose resolve-at-invoke helpers. Today's single-project workspace resolves
// to exactly one root component and behaves identically.

const SETTINGS_GLOB = "**/dataverse-powertools.json";
const EXCLUDE_GLOB = "**/{node_modules,bin,obj,.git,dist,out,test-resources,packages}/**";

export async function discoverWorkspaceComponents(context: DataversePowerToolsContext): Promise<DiscoveredComponent[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    context.components = [];
    return [];
  }
  const files = await vscode.workspace.findFiles(SETTINGS_GLOB, EXCLUDE_GLOB);
  const settingsFiles: { path: string; content: string }[] = [];
  for (const file of files) {
    try {
      settingsFiles.push({ path: file.fsPath, content: await fs.promises.readFile(file.fsPath, "utf8") });
    } catch {
      /* unreadable — skip; discovery reports malformed separately */
    }
  }
  // fs-backed io per component so io-dependent migrations run at discovery too.
  const { components, malformed } = resolveComponents(folders[0].uri.fsPath, settingsFiles, fsMigrationIo);
  for (const file of malformed) {
    context.channel.appendLine(`[Components] Skipping malformed settings file: ${file}`);
  }
  context.components = components;
  if (components.length > 1) {
    context.channel.appendLine(`[Components] ${components.length} components discovered: ${components.map((c) => c.relativeRoot || "(root)").join(", ")}`);
  }
  return components;
}

/** The folder commands should treat as the project root: the active component's
 * root, else the workspace root (single-component / legacy behaviour). */
export function activeComponentRoot(context: DataversePowerToolsContext): string | undefined {
  return context.activeComponent?.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * A context whose settings/paths are scoped to one component. The ROOT
 * component returns the base context untouched — byte-identical single-project
 * behaviour (its settings carry the readSettings post-processing and merged
 * credentials, which raw discovered settings don't).
 * Subfolder components get a prototype-delegating facade: methods, channel,
 * connection and panel plumbing come from the base context; projectSettings and
 * activeComponent are the component's own (settingsFilePath() follows).
 */
export function componentScopedContext(context: DataversePowerToolsContext, component: DiscoveredComponent): DataversePowerToolsContext {
  if (component.isRoot) {
    return context;
  }
  const scoped: DataversePowerToolsContext = Object.create(context);
  // ComponentSettings is the loosely-typed pure-module shape; at runtime the
  // enum values are the same strings the settings files carry.
  scoped.projectSettings = component.settings as DataversePowerToolsContext["projectSettings"];
  scoped.activeComponent = component;
  return scoped;
}

/**
 * Resolve which component a command invocation targets and run it with a
 * component-scoped context.
 * - An Explorer resource URI wins (the clicked file's owning component).
 * - A string hint (component root path, e.g. from a panel card) wins likewise.
 * - Exactly one component of the type → it (today's behaviour).
 * - None → legacy fallback: run unscoped when the root settings claim the type
 *   (pre-discovery workspaces), else explain.
 * - Several → quick-pick.
 */
export async function runForComponent<T>(
  context: DataversePowerToolsContext,
  type: ProjectTypes,
  hint: vscode.Uri | string | undefined,
  run: (scoped: DataversePowerToolsContext) => Promise<T> | T,
): Promise<T | undefined> {
  const ofType = componentsOfType(context.components ?? [], type);

  let component: DiscoveredComponent | undefined;
  if (hint) {
    const hintPath = typeof hint === "string" ? hint : hint.fsPath;
    const owner = componentForPath(context.components ?? [], hintPath);
    if (owner && owner.settings.type === type) {
      component = owner;
    } else if (typeof hint === "string") {
      // A panel-card hint names a component root explicitly — mismatches are a bug.
      component = ofType.find((c) => c.root === normalizeFsPath(hintPath));
    }
  }

  if (!component) {
    if (ofType.length === 1) {
      component = ofType[0];
    } else if (ofType.length === 0) {
      if (context.projectSettings.type === type) {
        return run(context); // legacy: settings loaded but discovery found nothing (e.g. mid-initialise)
      }
      vscode.window.showErrorMessage(`No ${type} component found in this workspace.`);
      return undefined;
    } else {
      const pick = await vscode.window.showQuickPick(
        ofType.map((c) => ({ label: c.relativeRoot || "(workspace root)", description: c.settings.solutionName as string | undefined, target: c })),
        { placeHolder: "Which component?" },
      );
      component = pick?.target;
    }
  }

  if (!component) {
    return undefined;
  }
  return run(componentScopedContext(context, component));
}
