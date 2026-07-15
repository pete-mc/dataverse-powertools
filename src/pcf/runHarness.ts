// Command: run the PCF test harness with watch/hot-reload (#141 / #150 #5, the
// "standalone harness" mode). `npm start watch` launches the pcf-scripts dev
// server (localhost) with its built-in hot reload — the easy inner loop for
// isolated UI work, no CDP and no live form needed (that's the separate live-form
// mode). Runs in a terminal (long-lived). Registered once via the PCF descriptor.

import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";
import { findControlDir } from "./controlManifest";

/** The pcf-scripts test-harness watch command (built-in hot reload). */
export function pcfHarnessCommand(): string {
  return "npm start watch";
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
