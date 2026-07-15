// VS Code-facing commands for Custom API definition-as-code (#142). Thin
// orchestration around the pure modules (definition / validate / generateHandler)
// — file discovery, prompts, and writing output. Plugin-scoped: a Custom API is a
// `*.customapi.json` file that lives inside a plugin component and is implemented
// by that plugin (the architecture decision for #142 v1).

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";
import { CUSTOM_API_FILE_SUFFIX, CustomApiDefinition, newCustomApiDefinition } from "./definition";
import { validateCustomApiDefinition } from "./validate";
import { generateCustomApiHandler, customApiHandlerFileName } from "./generateHandler";

/** All `*.customapi.json` files directly under a component root. */
export function findCustomApiDefinitionFiles(root: string): string[] {
  try {
    return fs
      .readdirSync(root)
      .filter((file) => file.toLowerCase().endsWith(CUSTOM_API_FILE_SUFFIX))
      .map((file) => path.join(root, file));
  } catch {
    return [];
  }
}

/** Scaffold a new sample `*.customapi.json` in the active plugin component. */
export async function newCustomApi(context: DataversePowerToolsContext): Promise<void> {
  const root = activeComponentRoot(context);
  if (!root) {
    vscode.window.showErrorMessage("Open or select a plugin component first.");
    return;
  }

  const uniqueName = await vscode.window.showInputBox({
    prompt: "Custom API unique name (e.g. sample_DoTheThing) — this becomes the message name.",
    validateInput: (value) => (/^[A-Za-z][A-Za-z0-9_]*$/.test(value.trim()) ? undefined : "Start with a letter; letters, digits and underscores only."),
  });
  if (!uniqueName) {
    return;
  }

  const pluginTypeName = await vscode.window.showInputBox({
    prompt: "Full plugin type name that implements it (namespace.Class), e.g. Sample.Plugins.DoTheThing.",
    value: `Dataverse.Plugins.${uniqueName.replace(/[^A-Za-z0-9_]/g, "")}`,
  });
  if (!pluginTypeName) {
    return;
  }

  const definition = newCustomApiDefinition(uniqueName.trim(), pluginTypeName.trim());
  const filePath = path.join(root, `${uniqueName.trim()}${CUSTOM_API_FILE_SUFFIX}`);
  if (fs.existsSync(filePath)) {
    vscode.window.showErrorMessage(`${path.basename(filePath)} already exists.`);
    return;
  }

  fs.writeFileSync(filePath, JSON.stringify(definition, null, 2) + "\n", "utf8");
  context.channel.appendLine(`Created Custom API definition: ${filePath}`);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc);
}

/** Validate every `*.customapi.json` in the active plugin component and generate
 * its typed C# handler. Skips (and reports) files that fail validation. */
export async function generateCustomApiHandlers(context: DataversePowerToolsContext): Promise<void> {
  const root = activeComponentRoot(context);
  if (!root) {
    vscode.window.showErrorMessage("Open or select a plugin component first.");
    return;
  }

  const files = findCustomApiDefinitionFiles(root);
  if (files.length === 0) {
    vscode.window.showInformationMessage(`No ${CUSTOM_API_FILE_SUFFIX} definitions found. Run "New Custom API definition" first.`);
    return;
  }

  const outDir = path.join(root, "CustomApi");
  let generated = 0;
  let failed = 0;

  for (const file of files) {
    const name = path.basename(file);
    let definition: CustomApiDefinition;
    try {
      definition = JSON.parse(fs.readFileSync(file, "utf8")) as CustomApiDefinition;
    } catch (error) {
      context.channel.appendLine(`✗ ${name}: not valid JSON — ${(error as Error).message}`);
      failed++;
      continue;
    }

    const errors = validateCustomApiDefinition(definition);
    if (errors.length > 0) {
      context.channel.appendLine(`✗ ${name}: ${errors.length} validation error(s):`);
      errors.forEach((e) => context.channel.appendLine(`    - ${e}`));
      failed++;
      continue;
    }

    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, customApiHandlerFileName(definition));
    fs.writeFileSync(outPath, generateCustomApiHandler(definition), "utf8");
    context.channel.appendLine(`✓ ${name} → CustomApi/${path.basename(outPath)}`);
    generated++;
  }

  if (failed > 0) {
    context.channel.show(true);
    vscode.window.showWarningMessage(`Custom API: generated ${generated}, ${failed} failed validation. See the Dataverse PowerTools output.`);
  } else {
    vscode.window.showInformationMessage(`Custom API: generated ${generated} typed handler(s) into CustomApi/.`);
  }
}
