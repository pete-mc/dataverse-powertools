// Command: scaffold the PCF service-layer template into a control (#141 option 3).
// Writes the service / hook / presentational-component / container files + a wired
// `index.ts.example` next to the control's ControlManifest.Input.xml. Additive —
// never overwrites the pac-generated index.ts (the wiring is a `.example` to copy
// in), so it can't break the build. Pure file contents in pcfServiceLayer.ts.

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";
import { serviceLayerFiles } from "./pcfServiceLayer";
import { findControlDir } from "./controlManifest";

export async function addPcfServiceLayer(context: DataversePowerToolsContext): Promise<void> {
  const root = activeComponentRoot(context);
  if (!root) {
    vscode.window.showErrorMessage("Open or select a PCF component first.");
    return;
  }
  const controlDir = findControlDir(root);
  if (!controlDir) {
    vscode.window.showErrorMessage("Couldn't find a ControlManifest.Input.xml — scaffold the PCF control first (pac pcf init).");
    return;
  }

  const entity = await vscode.window.showInputBox({
    prompt: "Example domain entity name for the service-layer scaffold.",
    value: "Widget",
    validateInput: (v) => (/^[A-Za-z][A-Za-z0-9]*$/.test(v.trim()) ? undefined : "Start with a letter; letters and digits only."),
  });
  if (!entity) {
    return;
  }

  const files = serviceLayerFiles(entity.trim());
  const written: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const target = path.join(controlDir, file.path);
    if (fs.existsSync(target)) {
      skipped.push(file.path);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, "utf8");
    written.push(file.path);
  }

  context.channel.appendLine(`\nPCF service layer scaffolded into ${path.basename(controlDir)}:`);
  written.forEach((p) => context.channel.appendLine(`  + ${p}`));
  skipped.forEach((p) => context.channel.appendLine(`  (skipped, exists) ${p}`));
  context.channel.appendLine("  Next: copy the imports + updateView from index.ts.example into your index.ts.");

  const example = path.join(controlDir, "index.ts.example");
  if (written.includes("index.ts.example") && fs.existsSync(example)) {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(example)));
  }
  if (skipped.length > 0) {
    vscode.window.showWarningMessage(`PCF service layer: wrote ${written.length}, skipped ${skipped.length} existing. See the output.`);
  } else {
    vscode.window.showInformationMessage(`PCF service layer scaffolded (${written.length} files). Wire index.ts from index.ts.example.`);
  }
}
