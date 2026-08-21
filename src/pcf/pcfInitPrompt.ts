import * as vscode from "vscode";
import { PcfTemplate, PcfFramework, PcfInitOptions, pcfInitArgs, isValidPcfName, isValidPcfNamespace } from "./pcfArgs";

// Scaffold-time quick-pick for a new PCF control (#141): let the user choose the control
// TEMPLATE (field vs dataset) and FRAMEWORK (none vs React) instead of always scaffolding
// the hardcoded field/none. The pure choice lists + the argv builder are unit-testable; only
// the two showQuickPick calls touch `vscode`. Runs once, up front, at PCF component init.

interface TemplatePick extends vscode.QuickPickItem {
  value: PcfTemplate;
}
interface FrameworkPick extends vscode.QuickPickItem {
  value: PcfFramework;
}

/** Default when the user dismisses a pick — matches the previous hardcoded scaffold, so
 * cancelling never breaks or surprises. */
export const PCF_INIT_DEFAULTS: PcfInitOptions = { template: "field", framework: "none" };

/** pac's own defaults when `--namespace`/`--name` are omitted, which is what every control this
 * extension scaffolded used to be called. Kept as the last-resort fallback only. */
export const PCF_FALLBACK_NAMESPACE = "SampleNamespace";
export const PCF_FALLBACK_NAME = "SampleControl";

/**
 * Turn a folder name into a PascalCase identifier usable as a control name — `acc-pcf` →
 * `AccPcf`, `my control 2` → `MyControl2`. Returns `fallback` when nothing usable survives.
 *
 * This is what makes two PCF components in one workspace get DIFFERENT control names by default
 * (#258): the deployed `customcontrol` row is named `{prefix}_{namespace}.{constructor}`, so
 * before this every control the extension scaffolded was `SampleNamespace.SampleControl` and the
 * second one deployed over the first.
 */
export function suggestPcfName(folderName: string, fallback = PCF_FALLBACK_NAME): string {
  const segments = folderName.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const pascal = segments.map((s) => s[0].toUpperCase() + s.slice(1)).join("");
  if (!pascal) {
    return fallback;
  }
  // A leading digit is legal in a folder name and not in an identifier.
  return isValidPcfName(pascal) ? pascal : `_${pascal}`;
}

/** Control-template choices (pure — unit-tested). field = a single bound property control;
 * dataset = a grid/data-set control. */
export function pcfTemplateChoices(): TemplatePick[] {
  return [
    { value: "field", label: "Field", description: "Bound to a single column (property control)" },
    { value: "dataset", label: "Dataset", description: "Bound to a grid / view (data-set control)" },
  ];
}

/** Rendering-framework choices (pure — unit-tested). none = vanilla TS/HTML; react = a
 * virtual/platform React control (pac scaffolds the React deps). */
export function pcfFrameworkChoices(): FrameworkPick[] {
  return [
    { value: "none", label: "Standard (no framework)", description: "Vanilla TypeScript / HTML" },
    { value: "react", label: "React", description: "Virtual control using the platform React libraries" },
  ];
}

/**
 * Ask for the PCF control template + framework and return the `pac pcf init` argv. Returns the
 * argv for the chosen options, or for PCF_INIT_DEFAULTS if the user escapes either pick (so the
 * scaffold still proceeds exactly as it did before). Never returns free-text — the argv tokens
 * come only from the fixed enums, so nothing user-typed reaches the command line.
 */
export async function promptPcfInitArgs(componentFolderName?: string): Promise<string[]> {
  const template = await vscode.window.showQuickPick(pcfTemplateChoices(), {
    placeHolder: "PCF control template",
    ignoreFocusOut: true,
  });
  const framework = await vscode.window.showQuickPick(pcfFrameworkChoices(), {
    placeHolder: "PCF rendering framework",
    ignoreFocusOut: true,
  });
  // The suggested name is derived from the component folder, so two PCF components in one
  // workspace differ by default. Escaping KEEPS the suggestion rather than reverting to pac's
  // SampleControl: the value is shown prefilled, so accepting it by escaping isn't a surprise —
  // and reverting would put the collision back (#258).
  const suggested = suggestPcfName(componentFolderName ?? "");
  const name =
    (await vscode.window.showInputBox({
      title: "PCF control name",
      prompt: "The control's name — part of how it is identified in Dataverse.",
      value: suggested,
      ignoreFocusOut: true,
      validateInput: (v) => (isValidPcfName(v.trim()) ? undefined : "Letters, digits and underscores only, and not starting with a digit."),
    })) ?? suggested;
  const namespace =
    (await vscode.window.showInputBox({
      title: "PCF control namespace",
      prompt: "The control's namespace — usually your company or product.",
      value: PCF_FALLBACK_NAMESPACE,
      ignoreFocusOut: true,
      validateInput: (v) => (isValidPcfNamespace(v.trim()) ? undefined : "Letters, digits, underscores and dots, and no segment starting with a digit."),
    })) ?? PCF_FALLBACK_NAMESPACE;
  const options: PcfInitOptions = {
    template: template?.value ?? PCF_INIT_DEFAULTS.template,
    framework: framework?.value ?? PCF_INIT_DEFAULTS.framework,
    namespace: namespace.trim(),
    name: name.trim(),
  };
  // pcfInitArgs yields ["pcf","init",…]; the restore runner prefixes "pac".
  return ["pac", ...pcfInitArgs(options)];
}
