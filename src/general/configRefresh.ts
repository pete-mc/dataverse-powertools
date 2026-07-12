// Config-file staleness + one-click refresh (#113).
//
// A project scaffolded by an older extension build keeps working, but its
// EXTENSION-OWNED config files (webpack/tsconfig/jest…) miss later fixes — the
// per-file output rework, inline source maps, the ts-jest transform move. The
// registry stamps a configRevision per type; settings record the revision the
// project's files were last written at; a lower stamp offers a refresh that
// backs up and re-renders ONLY the allowlisted files (never user code).

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext, { PowertoolsTemplate } from "../context";
import { getProjectTypeDescriptor, getTemplateFolderForType } from "../projectTypes/registry";
import { activeComponentRoot } from "../components/componentDiscovery";

export const UPGRADE_WIKI = "https://github.com/pete-mc/dataverse-powertools/wiki/Upgrading-Projects";
const BACKUP_DIR = ".dvpt-upgrade-backup";

/** Pure: does this component's config predate the type's current revision? */
export function isConfigStale(settings: { type?: string; configRevision?: number }, descriptor?: { configRevision: number; refreshableFiles: readonly string[] }): boolean {
  if (!descriptor || descriptor.refreshableFiles.length === 0) {
    return false;
  }
  return (settings.configRevision ?? 0) < descriptor.configRevision;
}

const notifiedRoots = new Set<string>();

/** Called per component at initialise: log + one-time-per-session toast when stale. */
export function checkConfigRevision(context: DataversePowerToolsContext): void {
  const descriptor = getProjectTypeDescriptor(context.projectSettings.type);
  const componentRoot = activeComponentRoot(context);
  if (!componentRoot || !descriptor || !isConfigStale(context.projectSettings, descriptor)) {
    return;
  }
  context.channel.appendLine(`[Upgrade] ${descriptor.displayName} config files predate this extension version. Refresh: 'Refresh Project Config Files'. Guide: ${UPGRADE_WIKI}`);
  if (notifiedRoots.has(componentRoot)) {
    return;
  }
  notifiedRoots.add(componentRoot);
  vscode.window
    .showInformationMessage(
      `This ${descriptor.displayName} project's config files predate this extension version — a refresh applies the latest webpack/tsconfig/jest fixes (your code is untouched).`,
      "Refresh config files",
      "What changed?",
    )
    .then((choice) => {
      if (choice === "Refresh config files") {
        void vscode.commands.executeCommand("dataverse-powertools.refreshConfigFiles", componentRoot);
      } else if (choice === "What changed?") {
        void vscode.env.openExternal(vscode.Uri.parse(UPGRADE_WIKI));
      }
    });
}

/** Backup + re-render the allowlisted config files, then stamp the revision. */
export async function refreshConfigFiles(context: DataversePowerToolsContext): Promise<void> {
  const componentRoot = activeComponentRoot(context);
  const descriptor = getProjectTypeDescriptor(context.projectSettings.type);
  if (!componentRoot || !descriptor || descriptor.refreshableFiles.length === 0) {
    vscode.window.showInformationMessage("This project type has no refreshable config files.");
    return;
  }
  const templateDir = context.vscode.asAbsolutePath(path.join("templates", getTemplateFolderForType(context.projectSettings.type)!));
  const template = (JSON.parse(fs.readFileSync(path.join(templateDir, "template.json"), "utf8")) as PowertoolsTemplate[]).find(
    (t) => t.version === context.projectSettings.templateversion,
  );
  if (!template?.files) {
    vscode.window.showErrorMessage("No matching template found for this project's template version.");
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const backupDir = path.join(componentRoot, BACKUP_DIR, stamp);
  const refreshed: string[] = [];
  for (const file of template.files) {
    const displayName = `${file.filename}${file.extension === ".tstemplate" ? ".ts" : file.extension}`;
    if (!descriptor.refreshableFiles.includes(displayName)) {
      continue;
    }
    const destination = path.join(componentRoot, ...(file.path ?? []), displayName);
    // Backup FIRST (rail): only files that exist need a backup.
    if (fs.existsSync(destination)) {
      await fs.promises.mkdir(backupDir, { recursive: true });
      await fs.promises.copyFile(destination, path.join(backupDir, displayName));
    }
    let data = fs.readFileSync(path.join(templateDir, file.filename + file.extension, `${file.version}${file.extension}`), "utf8");
    data = data.replace(/SOLUTIONPREFIX/g, context.projectSettings.prefix || "SOLUTIONPREFIX");
    data = data.replace(/SOLUTIONPLACEHOLDER/g, context.projectSettings.solutionName || "SOLUTIONPLACEHOLDER");
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.writeFile(destination, data);
    refreshed.push(displayName);
  }

  context.projectSettings.configRevision = descriptor.configRevision;
  await context.writeSettings();
  context.channel.appendLine(`[Upgrade] Refreshed ${refreshed.join(", ")} (backups in ${BACKUP_DIR}/${stamp}). Config revision -> ${descriptor.configRevision}.`);
  vscode.window.showInformationMessage(`Refreshed ${refreshed.length} config file(s) — originals backed up to ${BACKUP_DIR}/${stamp}. Run Restore Dependencies, then rebuild.`);
  context.refreshPanel?.();
}
