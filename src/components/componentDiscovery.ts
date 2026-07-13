import * as vscode from "vscode";
import fs = require("fs");
import DataversePowerToolsContext from "../context";
import { resolveComponents, DiscoveredComponent, resolveTargetComponent } from "./discovery";
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
 * component-scoped context (#47, #119). The ladder is explicit resource → active
 * editor → picker (see resolveTargetComponent):
 * - An Explorer/CodeLens resource URI or panel-card root string wins.
 * - Exactly one component of the type → it.
 * - Several, no hint → infer from the active editor when it belongs to a component
 *   of the right type; otherwise quick-pick.
 * - None → legacy fallback: run unscoped when the root settings claim the type
 *   (pre-discovery workspaces), else explain.
 */
export async function runForComponent<T>(
  context: DataversePowerToolsContext,
  type: ProjectTypes,
  hint: vscode.Uri | string | undefined,
  run: (scoped: DataversePowerToolsContext) => Promise<T> | T,
): Promise<T | undefined> {
  const components = context.components ?? [];
  const hintPath = hint === undefined ? undefined : typeof hint === "string" ? hint : hint.fsPath;
  const activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;

  const resolution = resolveTargetComponent(components, type, hintPath, activeFilePath);

  let component: DiscoveredComponent | undefined;
  if (resolution.kind === "resolved") {
    component = resolution.component;
  } else if (resolution.kind === "pick") {
    const pick = await vscode.window.showQuickPick(
      resolution.candidates.map((c) => ({
        label: c.relativeRoot || "(workspace root)",
        description: (c.settings.solutionName ?? c.settings.pluginProjectName) as string | undefined,
        target: c,
      })),
      { placeHolder: "Which component?", ignoreFocusOut: true },
    );
    component = pick?.target;
  } else {
    // none
    if (context.projectSettings.type === type) {
      return run(context); // legacy: settings loaded but discovery found nothing (e.g. mid-initialise)
    }
    vscode.window.showErrorMessage(`No ${type} component found in this workspace.`);
    return undefined;
  }

  if (!component) {
    return undefined;
  }
  return run(componentScopedContext(context, component));
}
