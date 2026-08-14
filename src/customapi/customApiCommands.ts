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
import { generateCustomApiWrappers, generateCustomApiUserHandler, looksLikeLegacyHandler, customApiHandlerFileName, customApiUserHandlerFileName } from "./generateHandler";
import { generateTypedClient, customApiClientFileName } from "./generateTypedClient";
import { findPrimaryPluginCsproj } from "../plugins/projectPaths";

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

/**
 * Where a generated C# handler belongs: the directory of the component's plug-in `.csproj`, falling back
 * to the component root when there is no project to put it in (the file is then at least visible, and
 * the deploy will say the type is missing rather than silently pointing at nothing).
 */
export async function customApiHandlerDirectory(root: string, preferredProjectName?: string): Promise<string> {
  const csproj = await findPrimaryPluginCsproj(root, preferredProjectName);
  return csproj ? path.dirname(csproj) : root;
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

  // Into the PLUG-IN PROJECT, not the component root. The handler declares the plug-in type the Custom
  // API points at, so it has to be inside the folder the .csproj compiles — an SDK-style project globs
  // `**/*.cs` under its own directory and nothing above it. Written to the component root it never
  // reached the assembly, the plug-in type never existed, and every Deploy Custom APIs ended in
  // "plugin type '…' not found in the environment". Same resolution the New plugin class command uses.
  const outDir = path.join(await customApiHandlerDirectory(root, context.projectSettings.pluginProjectName), "CustomApi");
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
    const wrappersPath = path.join(outDir, customApiHandlerFileName(definition));
    const userPath = path.join(outDir, customApiUserHandlerFileName(definition));
    const rel = (p: string): string => path.relative(root, p).replace(/\\/g, "/");

    // A `*.generated.cs` from before the split still holds the IPlugin implementation, so rewriting it
    // is exactly the data loss this split exists to prevent (#254). Refuse, and say what to do.
    if (fs.existsSync(wrappersPath) && !fs.existsSync(userPath) && looksLikeLegacyHandler(fs.readFileSync(wrappersPath, "utf8"))) {
      context.reportFailure(
        `${name}: ${rel(wrappersPath)} still contains your Execute implementation (older layout). ` +
          `Move the class into ${rel(userPath)}, then run this again — otherwise regenerating would overwrite your code.`,
        { toast: `Custom API: ${path.basename(wrappersPath)} holds your implementation — move it to ${path.basename(userPath)} first. See the output.` },
      );
      failed++;
      continue;
    }

    fs.writeFileSync(wrappersPath, generateCustomApiWrappers(definition), "utf8");
    // The implementation is written ONCE. Regenerating after a definition change refreshes the typed
    // wrappers and leaves your Execute body alone (#254).
    const wroteUser = !fs.existsSync(userPath);
    if (wroteUser) {
      fs.writeFileSync(userPath, generateCustomApiUserHandler(definition), "utf8");
    }
    // Say WHERE it landed relative to the component, so "which project is this compiled into?" is
    // answerable from the log — and whether your file was created or left as it was.
    context.channel.appendLine(`✓ ${name} → ${rel(wrappersPath)}${wroteUser ? ` + ${rel(userPath)}` : ` (${path.basename(userPath)} left as you wrote it)`}`);
    generated++;
  }

  if (failed > 0) {
    context.channel.show(true);
    vscode.window.showWarningMessage(`Custom API: generated ${generated}, ${failed} failed validation. See the Dataverse PowerTools output.`);
  } else {
    vscode.window.showInformationMessage(`Custom API: generated ${generated} typed handler(s) into CustomApi/.`);
  }
}

/** Validate every `*.customapi.json` and generate a typed TypeScript client
 * (for web-resource / PCF callers) into a `clients/` folder. */
export async function generateCustomApiClients(context: DataversePowerToolsContext): Promise<void> {
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

  const outDir = path.join(root, "clients");
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
    const outPath = path.join(outDir, customApiClientFileName(definition));
    fs.writeFileSync(outPath, generateTypedClient(definition), "utf8");
    context.channel.appendLine(`✓ ${name} → clients/${path.basename(outPath)} (copy into your web-resource / PCF project)`);
    generated++;
  }

  if (failed > 0) {
    context.channel.show(true);
    vscode.window.showWarningMessage(`Custom API clients: generated ${generated}, ${failed} failed validation. See the Dataverse PowerTools output.`);
  } else {
    vscode.window.showInformationMessage(`Custom API: generated ${generated} typed TS client(s) into clients/.`);
  }
}
