import * as vscode from "vscode";
import fs = require("fs");
import DataversePowerToolsContext from "../context";
import { parseRegisterEvents, lineOfOffset } from "../webresources/registerEventParser";
import { componentsOfType } from "../components/discovery";
import { ProjectTypes } from "../projectTypes/registry";

// Workspace scan of <PowerTools.RegisterEvent[]> decorations for the actions
// panel's registrations card (#100 v2). Cached; rescanned on activation and on
// every save under webresources_src so the card tracks the source of truth
// (the TS files), not stale settings.

export interface ScannedRegistration {
  functionName: string;
  event: string;
  file: string;
  /** 0-based line of the decoration, for go-to-file. */
  line: number;
  /** Owning web-resource component root; undefined for legacy workspace-wide scans (#47). */
  componentRoot?: string;
}

let cache: ScannedRegistration[] = [];

export function getScannedRegistrations(): ScannedRegistration[] {
  return cache;
}

export async function scanFormRegistrations(context: DataversePowerToolsContext): Promise<void> {
  try {
    // One scan per web-resource component (#47); a legacy workspace with no
    // discovered components falls back to the workspace-wide glob.
    const roots = componentsOfType(context.components ?? [], ProjectTypes.webresource).map((c) => c.root);
    const globs =
      roots.length > 0
        ? roots.map((root) => ({ root, pattern: new vscode.RelativePattern(root, "webresources_src/**/*.ts") as vscode.GlobPattern }))
        : [{ root: undefined as string | undefined, pattern: "webresources_src/**/*.ts" as vscode.GlobPattern }];

    const found: ScannedRegistration[] = [];
    for (const { root, pattern } of globs) {
      const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**");
      for (const file of files) {
        const text = await fs.promises.readFile(file.fsPath, "utf8");
        for (const event of parseRegisterEvents(text).events) {
          found.push({ functionName: event.function, event: event.event, file: file.fsPath, line: lineOfOffset(text, event.offset), componentRoot: root });
        }
      }
    }
    found.sort((a, b) => a.functionName.localeCompare(b.functionName) || a.event.localeCompare(b.event));
    cache = found;
  } catch (err) {
    context.channel.appendLine(`[Panel] Failed to scan form registrations: ${err}`);
  }
  context.refreshPanel?.();
}

/** Rescan when a web-resource source file is saved (cheap: only the src glob). */
export function registerRegistrationsWatcher(context: DataversePowerToolsContext): void {
  context.vscode.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      const file = document.fileName.replace(/\\/g, "/");
      if (file.includes("/webresources_src/") && file.endsWith(".ts")) {
        void scanFormRegistrations(context);
      }
    }),
  );
}

/** Open the file behind a registrations-card row at the decoration line. The
 * webview only ever sends an index — never a path. */
export async function openScannedRegistration(index: number): Promise<void> {
  const registration = cache[index];
  if (!registration) {
    return;
  }
  const document = await vscode.workspace.openTextDocument(registration.file);
  const editor = await vscode.window.showTextDocument(document);
  const position = new vscode.Position(registration.line, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}
