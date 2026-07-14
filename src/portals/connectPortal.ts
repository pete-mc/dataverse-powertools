import * as vscode from "vscode";
import * as fs from "fs";
import DataversePowerToolsContext from "../context";
import { parsePacPagesList, PacPage } from "./pacOutput";
import { pacPagesListArgs, pacPagesDownloadArgs, pacPagesUploadArgs } from "./pacPagesArgs";
import { ensurePacAuthForCurrentConnection, runPacLoggedHealing, runPacResult } from "../general/pacAuth";
import { activeComponentRoot } from "../components/componentDiscovery";
import path = require("path");

// Power Pages round-trip on pac (#74): list/download/upload against the shared
// dataverse-powertools pac auth profile (same model as solutions/modelbuilder),
// pure arg builders, tolerant list parsing, and the selected site + download
// folder remembered in dataverse-powertools.json.

export type PortalMode = "connect" | "download" | "upload";

function portalDownloadDirectory(context: DataversePowerToolsContext, workspacePath: string): string {
  return path.join(workspacePath, (context.projectSettings.portalDownloadPath as string) || "portalpublish");
}

async function pickSite(context: DataversePowerToolsContext, workspacePath: string): Promise<PacPage | undefined> {
  const list = await runPacResult(pacPagesListArgs(), workspacePath);
  if (list.stdout) {
    context.channel.appendLine(list.stdout);
  }
  if (list.code !== 0) {
    if (list.stderr) {
      context.channel.appendLine(list.stderr);
    }
    context.channel.show();
    vscode.window.showErrorMessage("pac pages list failed. See the Dataverse PowerTools output.");
    return undefined;
  }
  const sites = parsePacPagesList(list.stdout);
  if (sites.length === 0) {
    vscode.window.showErrorMessage("No Power Pages websites were found in this environment.");
    return undefined;
  }
  const remembered = context.projectSettings.portalWebsiteId as string | undefined;
  const pick = await vscode.window.showQuickPick(
    sites.map((site) => ({
      label: (site.websiteId === remembered ? "$(star-full) " : "") + (site.friendlyName || site.websiteId),
      description: site.websiteId,
      target: site,
    })),
    { placeHolder: "Select a Power Pages website" },
  );
  if (!pick) {
    return undefined;
  }
  // Remember the site so download/upload target it without re-picking.
  context.projectSettings.portalWebsiteId = pick.target.websiteId;
  context.projectSettings.portalWebsiteName = pick.target.friendlyName;
  await context.writeSettings();
  context.refreshPanel?.();
  return pick.target;
}

export async function connectPortal(context: DataversePowerToolsContext, mode: PortalMode): Promise<void> {
  const workspacePath = activeComponentRoot(context);
  if (!workspacePath) {
    vscode.window.showErrorMessage("Open a workspace folder first.");
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: mode === "upload" ? "Uploading Power Pages site..." : mode === "download" ? "Downloading Power Pages site..." : "Connecting to Power Pages...",
    },
    async () => {
      // Shared pac auth: service principals (re)create the extension's profile;
      // OAuth creates one interactively when none exists (#103 behaviour).
      if (!(await ensurePacAuthForCurrentConnection(context, workspacePath))) {
        return;
      }

      if (mode === "connect") {
        const site = await pickSite(context, workspacePath);
        if (site) {
          vscode.window.showInformationMessage(`Connected to ${site.friendlyName || site.websiteId} — Download / Upload now target this site.`);
        }
        return;
      }

      if (mode === "download") {
        let websiteId = context.projectSettings.portalWebsiteId as string | undefined;
        if (!websiteId) {
          websiteId = (await pickSite(context, workspacePath))?.websiteId;
        }
        if (!websiteId) {
          return;
        }
        const downloadPath = portalDownloadDirectory(context, workspacePath);
        const ok = await runPacLoggedHealing(context, pacPagesDownloadArgs({ websiteId, path: downloadPath, overwrite: true }), workspacePath);
        if (ok) {
          vscode.window.showInformationMessage(`Power Pages site downloaded to ${path.basename(downloadPath)}.`);
        } else {
          vscode.window.showErrorMessage("pac pages download failed. See the Dataverse PowerTools output.");
        }
        return;
      }

      // upload
      const uploadRoot = portalDownloadDirectory(context, workspacePath);
      // pac pages download nests the site in a subfolder of the target path;
      // upload wants the folder containing website.yml. Use it directly when
      // present, else the single site subfolder.
      let uploadPath = uploadRoot;
      if (!fs.existsSync(path.join(uploadRoot, "website.yml"))) {
        const subfolders = fs.existsSync(uploadRoot) ? fs.readdirSync(uploadRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()) : [];
        const siteFolder = subfolders.find((entry) => fs.existsSync(path.join(uploadRoot, entry.name, "website.yml")));
        if (!siteFolder) {
          vscode.window.showErrorMessage(`No downloaded site found under ${uploadRoot} — run Download Portal first.`);
          return;
        }
        uploadPath = path.join(uploadRoot, siteFolder.name);
      }
      const ok = await runPacLoggedHealing(context, pacPagesUploadArgs({ path: uploadPath }), workspacePath);
      if (ok) {
        vscode.window.showInformationMessage("Power Pages site uploaded.");
      } else {
        vscode.window.showErrorMessage("pac pages upload failed. See the Dataverse PowerTools output.");
      }
    },
  );
}

/** Back-compat wrapper: the old signature took "connect" | "download". */
export async function downloadPortal(context: DataversePowerToolsContext): Promise<void> {
  await connectPortal(context, "download");
}
