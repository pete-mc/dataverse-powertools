import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";
import { ProjectTypes } from "../projectTypes/registry";
import {
  deployedWebresourceNames,
  findWebresourceNameCollisions,
  freeLibraryBase,
  libraryBaseFor,
  isValidLibraryBase,
  webresourceLibraryName,
  DEFAULT_LIBRARY_BASE,
} from "./libraryNames";

// Change a web-resource component's bundle name after scaffold (#258 follow-up).
//
// The scaffold prompt gives NEW components distinct names, but anything created before that shares
// `{prefix}_library.js` with every other component — and deploy upserts bin/ by filename, so the
// second one to deploy silently replaces the first. This is the only in-product way to fix an
// existing project; without it the answer was "hand-edit dataverse-powertools.json".
//
// Renaming has two consequences the command has to handle rather than leave as surprises:
//  1. bin/ still holds the bundle under the OLD name, and deploy would upload it again — so the
//     stale artefact is cleared, exactly as switchOutputMode does on a mode change.
//  2. forms still carry handlers bound to the OLD name. Those are ours, so they must stay
//     deletable: the previous name is recorded in settings and candidateLibraryNames keeps
//     owning it, otherwise the next Register Form Events would strand them on a web resource
//     that is no longer deployed.

/** The two fields that decide what a component deploys, pulled out of its loose settings bag. */
function outputSettings(settings: { [key: string]: unknown } | undefined): { webresourceLibraryName?: string; webresourceOutput?: "bundle" | "perFile" } {
  const name = settings?.webresourceLibraryName;
  const output = settings?.webresourceOutput;
  return {
    webresourceLibraryName: typeof name === "string" ? name : undefined,
    webresourceOutput: output === "perFile" ? "perFile" : output === "bundle" ? "bundle" : undefined,
  };
}

/** Names every OTHER web-resource component in this workspace would deploy. */
function namesClaimedByOtherComponents(context: DataversePowerToolsContext, prefix: string): Set<string> {
  // Identify "this component" by relativeRoot, not by comparing absolute paths: activeComponentRoot
  // falls back to the raw workspace fsPath, which on Windows is backslashed while
  // DiscoveredComponent.root is normalised — so a string compare would fail to exclude the current
  // component and it would be reported as colliding with itself.
  const currentRelativeRoot = context.activeComponent?.relativeRoot ?? "";
  const claimed = new Set<string>();
  for (const component of context.components) {
    if (component.relativeRoot === currentRelativeRoot || component.settings?.type !== ProjectTypes.webresource) {
      continue;
    }
    const sourceRoot = path.join(component.root, "webresources_src");
    let sources: string[] = [];
    try {
      sources = fs.readdirSync(sourceRoot);
    } catch {
      sources = [];
    }
    for (const name of deployedWebresourceNames(prefix, outputSettings(component.settings), sources)) {
      claimed.add(name);
    }
  }
  return claimed;
}

export async function switchWebresourceLibraryName(context: DataversePowerToolsContext): Promise<void> {
  const componentRoot = activeComponentRoot(context);
  if (!componentRoot) {
    vscode.window.showErrorMessage("Open a workspace folder first.");
    return;
  }
  const prefix = context.projectSettings.prefix;
  if (!prefix) {
    vscode.window.showErrorMessage("This project has no solution prefix configured, so the deployed name is unknown. Connect to an environment first.");
    return;
  }
  if (context.projectSettings.webresourceOutput === "perFile") {
    // Nothing to rename: per-file names come from the source filenames.
    vscode.window.showInformationMessage("This component builds one web resource per source file, so there is no bundle name to change. Switch to the bundled output mode first.");
    return;
  }

  const current = libraryBaseFor(context.projectSettings);
  const claimed = namesClaimedByOtherComponents(context, prefix);
  // Offer a name that is actually free, so accepting the default resolves a collision rather than
  // reproducing one.
  const claimedBases = [...claimed].map((name) => (name.startsWith(`${prefix}_`) ? name.slice(prefix.length + 1) : name).replace(/\.js$/, ""));
  const suggestion = freeLibraryBase(current, claimedBases);

  const answer = await vscode.window.showInputBox({
    title: "Web resource bundle name",
    prompt: `Currently deploys as ${webresourceLibraryName(prefix, "bundle", "library.ts", current)}. Each component needs its own name — they overwrite each other otherwise.`,
    value: suggestion,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!isValidLibraryBase(trimmed)) {
        return "Letters, digits and underscores only.";
      }
      const proposed = webresourceLibraryName(prefix, "bundle", "library.ts", trimmed);
      // Say so while they type rather than after they've rebuilt and deployed over someone.
      return claimed.has(proposed) ? `${proposed} is already deployed by another component in this workspace.` : undefined;
    },
  });
  const next = answer?.trim();
  if (!next || next === current) {
    return;
  }

  // Keep the old name owned so its handlers stay deletable (see the header note).
  const history = new Set(context.projectSettings.webresourcePreviousLibraryNames ?? []);
  history.add(current);
  history.delete(next);
  // "library" needs no recording — candidateLibraryNames always owns it.
  context.projectSettings.webresourcePreviousLibraryNames = [...history].filter((name) => name !== DEFAULT_LIBRARY_BASE);
  context.projectSettings.webresourceLibraryName = next;
  await context.writeSettings();

  // bin/ still holds the bundle under the old name; deploy would upload it again.
  const binDir = path.join(componentRoot, "bin");
  const stale = webresourceLibraryName(prefix, "bundle", "library.ts", current);
  const stalePath = path.join(binDir, stale);
  if (fs.existsSync(stalePath)) {
    await fs.promises.rm(stalePath, { force: true });
    context.channel.appendLine(`Removed bin/${stale} — it would otherwise be deployed again under the old name.`);
  }

  const renamed = webresourceLibraryName(prefix, "bundle", "library.ts", next);
  context.channel.appendLine(`Web resource bundle renamed: ${stale} -> ${renamed}. Run Build, then Deploy.`);
  context.channel.appendLine(`${stale} is still deployed in the environment — delete it there once no form references it.`);
  context.refreshPanel?.();
  vscode.window.showInformationMessage(`Bundle renamed to ${renamed}. Run Build then Deploy; the old ${stale} is still in the environment.`);
}

/** Collisions between this workspace's web-resource components, for surfacing to the user. */
export function webresourceCollisionsInWorkspace(context: DataversePowerToolsContext, prefix: string): Array<{ name: string; components: string[] }> {
  const claims = context.components
    .filter((component) => component.settings?.type === ProjectTypes.webresource)
    .map((component) => {
      let sources: string[] = [];
      try {
        sources = fs.readdirSync(path.join(component.root, "webresources_src"));
      } catch {
        sources = [];
      }
      return { relativeRoot: component.relativeRoot, names: deployedWebresourceNames(prefix, outputSettings(component.settings), sources) };
    });
  return findWebresourceNameCollisions(claims);
}
