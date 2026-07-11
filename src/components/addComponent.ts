import * as vscode from "vscode";
import fs = require("fs");
import path = require("path");
import DataversePowerToolsContext from "../context";
import { projectTypeRegistry, ProjectTypes } from "../projectTypes/registry";
import { getProjectTypeActivation } from "../projectTypes/activation";
import { generateTemplates } from "../general/generateTemplates";
import { restoreDependencies } from "../general/restoreDependencies";
import { discoverWorkspaceComponents, componentScopedContext } from "./componentDiscovery";
import { DiscoveredComponent, normalizeFsPath, componentForPath } from "./discovery";

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

  // The component's own settings: type + template version only — everything
  // else (connection, prefix, environment label) is inherited from the root.
  const componentSettings: DiscoveredComponent["settings"] = {
    type: descriptor.id,
    templateversion: descriptor.defaultTemplateVersion,
    solutionName: context.projectSettings.solutionName,
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
      await restoreDependencies(scoped);

      // Re-discover, initialise the (possibly new) type, refresh the panel.
      await discoverWorkspaceComponents(context);
      const activation = getProjectTypeActivation(descriptor.id);
      await activation?.initialise(scoped);
      context.refreshPanel?.();
    },
  );
  vscode.window.showInformationMessage(`${descriptor.displayName} component added in ${folderName} (inherits the workspace connection).`);
}
