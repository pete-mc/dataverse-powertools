import * as vscode from "vscode";
import { PcfTemplate, PcfFramework, PcfInitOptions, pcfInitArgs } from "./pcfArgs";

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
export async function promptPcfInitArgs(): Promise<string[]> {
  const template = await vscode.window.showQuickPick(pcfTemplateChoices(), {
    placeHolder: "PCF control template",
    ignoreFocusOut: true,
  });
  const framework = await vscode.window.showQuickPick(pcfFrameworkChoices(), {
    placeHolder: "PCF rendering framework",
    ignoreFocusOut: true,
  });
  const options: PcfInitOptions = {
    template: template?.value ?? PCF_INIT_DEFAULTS.template,
    framework: framework?.value ?? PCF_INIT_DEFAULTS.framework,
  };
  // pcfInitArgs yields ["pcf","init",…]; the restore runner prefixes "pac".
  return ["pac", ...pcfInitArgs(options)];
}
