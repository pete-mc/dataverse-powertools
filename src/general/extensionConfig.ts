import * as vscode from "vscode";

// Reads of the extension's own VS Code settings (`contributes.configuration`),
// in one place so the defaults live next to each other and the rest of the code
// never string-literals a setting id. Project settings (dataverse-powertools.json)
// are a different thing entirely — see src/context.ts.

const SECTION = "dataverse-powertools";

/** Number of components at which the panel's component cards start collapsed.
 * Default 3: one or two components stay expanded, three or more collapse. */
export const DEFAULT_COLLAPSE_CARDS_FROM = 3;

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

/** Preview features opt-in (`dataverse-powertools.previewFeatures`), off by default. */
export function previewFeaturesEnabled(): boolean {
  return config().get<boolean>("previewFeatures") === true;
}

/** Flip the preview-features flag (panel footer checkbox). Written globally — it's a
 * per-user choice about what the extension exposes, not a per-workspace fact. */
export async function setPreviewFeaturesEnabled(enabled: boolean): Promise<void> {
  await config().update("previewFeatures", enabled, vscode.ConfigurationTarget.Global);
}

/** Component count from which cards start collapsed (`collapseCardsFrom`). */
export function collapseCardsFrom(): number {
  const value = config().get<number>("collapseCardsFrom");
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : DEFAULT_COLLAPSE_CARDS_FROM;
}

/** Whether a workspace with this many components should render cards collapsed by default. */
export function collapseCardsByDefault(componentCount: number): boolean {
  return componentCount >= collapseCardsFrom();
}

/** Settings that change what the actions panel renders — the panel re-renders when one changes. */
export function affectsPanelConfiguration(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration(`${SECTION}.previewFeatures`) || event.affectsConfiguration(`${SECTION}.collapseCardsFrom`);
}
