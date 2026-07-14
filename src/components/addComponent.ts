import * as vscode from "vscode";
import fs = require("fs");
import path = require("path");
import DataversePowerToolsContext from "../context";
import { projectTypeRegistry, ProjectTypes, getProjectTypeDescriptor } from "../projectTypes/registry";
import { getProjectTypeActivation } from "../projectTypes/activation";
import { generateTemplates, normalizePluginV3Layout } from "../general/generateTemplates";
import { restoreDependencies } from "../general/restoreDependencies";
import { discoverWorkspaceComponents, componentScopedContext } from "./componentDiscovery";
import { DiscoveredComponent, normalizeFsPath, componentForPath } from "./discovery";
import { planNestedMigrationMoves, splitSettingsForNestedMigration } from "./nestedMigration";

// "Add Component" (#47): scaffold a second (third, …) project type into a
// subfolder of the current workspace. The subfolder gets its own
// dataverse-powertools.json WITHOUT a connection string, so it inherits the
// root's connection — a repo becomes multi-component the first time this runs.

function sanitizeFolderName(input: string): string | undefined {
  const trimmed = input.trim().replace(/[\\/]+$/, "");
  if (!trimmed || /[<>:"|?*]/.test(trimmed) || trimmed.includes("..")) {
    return undefined;
  }
  return trimmed;
}

/** When the workspace root is itself a typed project (the single-project layout),
 * offer to switch to the nested layout before adding the second component: move
 * the existing project into a subfolder and leave a connection-only root behind,
 * exactly like the "Empty (components in subfolders)" wizard option. Returns
 * false when the user cancels the whole Add Component flow. */
async function offerNestedMigration(context: DataversePowerToolsContext, workspaceRoot: string): Promise<boolean> {
  if (!context.projectSettings.type) {
    return true; // root is already connection-only — nothing to migrate
  }
  const typeName = getProjectTypeDescriptor(context.projectSettings.type)?.displayName ?? context.projectSettings.type;
  const pick = await vscode.window.showQuickPick(
    [
      { label: `Yes — move the ${typeName} project into a subfolder first`, description: "recommended", target: "migrate" },
      { label: "No — keep it at the root and nest the new component inside it", target: "keep" },
    ],
    {
      placeHolder: `This workspace is a single ${typeName} project. Switch to the nested layout (connection-only root, one subfolder per component)?`,
      ignoreFocusOut: true,
    },
  );
  if (!pick) {
    return false;
  }
  if (pick.target === "keep") {
    return true;
  }
  return performNestedMigration(context, workspaceRoot, typeName);
}

/** Move the current typed root project into a subfolder so the workspace root
 * becomes connection-only (Empty). Returns true when the migration completed (#118). */
export async function performNestedMigration(context: DataversePowerToolsContext, workspaceRoot: string, typeName: string): Promise<boolean> {
  const folderInput = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: `Subfolder to move the existing ${typeName} project into`,
    value: getProjectTypeDescriptor(context.projectSettings.type)?.templateFolder ?? "project",
    validateInput: (value) => {
      const cleaned = sanitizeFolderName(value ?? "");
      if (!cleaned) {
        return "Enter a valid relative folder name.";
      }
      if (fs.existsSync(path.join(workspaceRoot, cleaned))) {
        return "That folder already exists.";
      }
      return undefined;
    },
  });
  const folderName = sanitizeFolderName(folderInput ?? "");
  if (!folderName) {
    return false;
  }

  // Split the current root settings BEFORE touching the disk: the connection
  // stays on the root (components inherit it), everything project-specific
  // moves with the project.
  const settingsPath = path.join(workspaceRoot, "dataverse-powertools.json");
  const currentSettings = JSON.parse(await fs.promises.readFile(settingsPath, "utf8"));
  const { rootSettings, componentSettings } = splitSettingsForNestedMigration(currentSettings);

  const destination = path.join(workspaceRoot, folderName);
  await fs.promises.mkdir(destination, { recursive: true });
  const entries = await fs.promises.readdir(workspaceRoot);
  const failures: string[] = [];
  for (const entry of planNestedMigrationMoves(entries, folderName)) {
    try {
      await fs.promises.rename(path.join(workspaceRoot, entry), path.join(destination, entry));
    } catch {
      failures.push(entry); // locked by a watcher/terminal — report, don't abort
    }
  }
  await fs.promises.writeFile(path.join(destination, "dataverse-powertools.json"), JSON.stringify(componentSettings, null, 2));
  await fs.promises.writeFile(settingsPath, JSON.stringify(rootSettings, null, 2));

  if (failures.length > 0) {
    vscode.window.showWarningMessage(
      `Moved the ${typeName} project to ${folderName}, but these entries could not be moved (close any watchers or terminals using them, then move them manually): ${failures.join(", ")}`,
    );
  }

  // Reload: the root is now connection-only and the moved project is a
  // discovered subfolder component.
  await context.readSettings();
  await discoverWorkspaceComponents(context);
  context.refreshPanel?.();
  context.channel.appendLine(`Moved the existing ${typeName} project into ${folderName}; the workspace root is now connection-only.`);
  return true;
}

export async function addComponent(context: DataversePowerToolsContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage("Open a workspace folder first.");
    return;
  }
  if (!context.projectSettings.connectionString) {
    vscode.window.showErrorMessage("Initialise the workspace (connection) first — components inherit the root connection.");
    return;
  }

  const typePick = await vscode.window.showQuickPick(
    projectTypeRegistry.map((d) => ({ label: d.displayName, target: d })),
    { placeHolder: "Which component type?" },
  );
  if (!typePick) {
    return;
  }
  const descriptor = typePick.target;

  // Single-project root? Offer the switch to the nested layout first (the
  // existing project moves into a subfolder, the root goes connection-only).
  if (!(await offerNestedMigration(context, workspaceRoot))) {
    return;
  }

  const folderInput = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: `Subfolder for the new ${descriptor.displayName} component (relative to the workspace root)`,
    value: descriptor.templateFolder,
    validateInput: (value) => {
      const cleaned = sanitizeFolderName(value ?? "");
      if (!cleaned) {
        return "Enter a valid relative folder name.";
      }
      const target = path.join(workspaceRoot, cleaned);
      if (fs.existsSync(path.join(target, "dataverse-powertools.json"))) {
        return "That folder is already a component.";
      }
      if (componentForPath(context.components ?? [], target) && !componentForPath(context.components ?? [], target)?.isRoot) {
        return "That folder is inside another component.";
      }
      return undefined;
    },
  });
  const folderName = sanitizeFolderName(folderInput ?? "");
  if (!folderName) {
    return;
  }

  const componentRoot = path.join(workspaceRoot, folderName);
  await fs.promises.mkdir(componentRoot, { recursive: true });

  // The component's own settings. The connection stays inherited from the root
  // (never written here), but the publisher PREFIX is carried so template
  // generation can substitute SOLUTIONPREFIX now — the same prefix gets baked into
  // the component's webpack.common.js, so it belongs with the component (and
  // discovery would inherit the same value anyway). Fixes SOLUTIONPREFIX not being
  // replaced when adding a web-resource component to a blank root.
  const componentSettings: DiscoveredComponent["settings"] = {
    type: descriptor.id,
    templateversion: descriptor.defaultTemplateVersion,
    configRevision: descriptor.configRevision,
    solutionName: context.projectSettings.solutionName,
    prefix: context.projectSettings.prefix,
  };
  const component: DiscoveredComponent = {
    root: normalizeFsPath(componentRoot),
    relativeRoot: folderName.replace(/\\/g, "/"),
    isRoot: false,
    settings: componentSettings,
  };
  const scoped = componentScopedContext(context, component);

  // Plugin components carry their project/package names in settings.
  if (descriptor.id === ProjectTypes.plugin) {
    const projectName = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: "Plugin project name", value: "Plugin" });
    if (!projectName) {
      return;
    }
    componentSettings.pluginProjectName = projectName.trim();
    componentSettings.pluginPackageName = projectName.trim();
    componentSettings.pluginPackageVersion = "1.0.0";
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Adding ${descriptor.displayName} component in ${folderName}...`,
    },
    async () => {
      await generateTemplates(scoped, componentRoot);
      await scoped.writeSettings();
      await restoreDependencies(scoped, true);
      // Mirror createNewProject: pac plugin init nests the csproj under the
      // project folder, and only the layout normalisation creates the .sln the
      // final `dotnet restore` needs — skipping it made that restore fail with
      // MSB1003 (caught by the e2e log audit on the blank-root suite).
      await normalizePluginV3Layout(scoped);
      await restoreDependencies(scoped);

      // Re-discover, initialise the (possibly new) type, refresh the panel.
      await discoverWorkspaceComponents(context);
      const activation = getProjectTypeActivation(descriptor.id);
      await activation?.initialise(scoped);
      context.refreshPanel?.();
    },
  );
  vscode.window.showInformationMessage(`${descriptor.displayName} component added in ${folderName} (inherits the workspace connection).`);

  // First-create onboarding (#126) — e.g. web resources generate typings + offer a class.
  // Best-effort: the component is already added, so a hiccup here must not fail Add Component.
  try {
    await getProjectTypeActivation(descriptor.id)?.onComponentAdded?.(scoped);
  } catch (error) {
    scoped.channel.appendLine(`[Add Component] Post-add onboarding failed (non-fatal): ${error}`);
  }
}

/** Convert a single-typed-project workspace into a components workspace (#118): move
 * the root project into a subfolder so the root is connection-only, then Add Component
 * becomes available. On an already-Empty root it just points at Add Component. */
export async function convertToComponentsWorkspace(context: DataversePowerToolsContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage("Open a workspace folder first.");
    return;
  }
  if (!context.projectSettings.type) {
    const choice = await vscode.window.showInformationMessage("This workspace is already a components workspace (connection-only root).", "Add Component");
    if (choice === "Add Component") {
      await addComponent(context);
    }
    return;
  }
  const typeName = getProjectTypeDescriptor(context.projectSettings.type)?.displayName ?? context.projectSettings.type;
  if (await performNestedMigration(context, workspaceRoot, typeName)) {
    const choice = await vscode.window.showInformationMessage(`Converted — the ${typeName} project moved to a subfolder and the root is now connection-only.`, "Add Component");
    if (choice === "Add Component") {
      await addComponent(context);
    }
  }
}
