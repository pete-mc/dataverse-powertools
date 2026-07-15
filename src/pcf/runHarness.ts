// Command: run the PCF test harness with watch/hot-reload (#141 / #150 #5, the
// "standalone harness" mode). `npm start watch` launches the pcf-scripts dev
// server (localhost) with its built-in hot reload — the easy inner loop for
// isolated UI work, no CDP and no live form needed (that's the separate live-form
// mode). Runs in a terminal (long-lived). Registered once via the PCF descriptor.

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";

/** The pcf-scripts test-harness watch command (built-in hot reload). */
export function pcfHarnessCommand(): string {
  return "npm start watch";
}

/** Directory holding the control's ControlManifest.Input.xml (has its package.json). */
function findControlDir(root: string): string | undefined {
  const walk = (dir: string): string | undefined => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    if (entries.some((e) => e.isFile() && e.name === "ControlManifest.Input.xml")) {
      return dir;
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== "node_modules" && e.name !== "out" && e.name !== "generated" && !e.name.startsWith(".")) {
        const found = walk(path.join(dir, e.name));
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  };
  return walk(root);
}

export function runPcfHarness(context: DataversePowerToolsContext): void {
  const root = activeComponentRoot(context);
  if (!root) {
    vscode.window.showErrorMessage("Open or select a PCF component first.");
    return;
  }
  const controlDir = findControlDir(root) ?? root;
  context.channel.appendLine("Starting the PCF test harness with hot reload (npm start watch) — see the terminal. Stop it with Ctrl+C.");
  const terminal = vscode.window.createTerminal({ name: "PCF harness (watch)", cwd: controlDir });
  terminal.show(true);
  terminal.sendText(pcfHarnessCommand());
}
