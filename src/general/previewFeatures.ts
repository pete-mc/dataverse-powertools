// Preview features: the single list of surfaces that ship DISABLED unless the
// user opts in via `dataverse-powertools.previewFeatures`.
//
// Why: a full (non-pre-release) release should only expose flows that have been
// manually verified. Rather than ripping unverified features out and putting
// them back, they stay in the build behind one flag — off by default, one
// checkbox (panel footer) or one setting to turn on.
//
// This module is PURE (no `vscode` import) so the panel view-model and the
// package.json parity tests can use it. The setting itself is read in
// ./extensionConfig.ts.

export interface PreviewFeature {
  id: string;
  /** Shown in the panel notice and the issue/docs text. */
  label: string;
  /** One line on what is still unverified. */
  note: string;
  /** GitHub issue holding this feature's manual-test checklist — the sign-off that un-gates it. */
  manualTestIssue: number;
  /** Project types entirely behind the flag — their cards and picker entries disappear. */
  projectTypes: readonly string[];
  /** Commands hidden from the panel (and gated in package.json `enablement`) while off. */
  commands: readonly string[];
}

const prefix = "dataverse-powertools.";

export const PREVIEW_FEATURES: readonly PreviewFeature[] = [
  {
    id: "azureFunctions",
    label: "Azure Functions",
    note: "Scaffold, webhook/step registration, local host and publish are not manually verified yet.",
    manualTestIssue: 223,
    projectTypes: ["azurefunction"],
    commands: [
      `${prefix}registerWebhookStep`,
      `${prefix}buildAzureFunction`,
      `${prefix}generateAzureFunctionEarlyBound`,
      `${prefix}deployAzureFunctionGuide`,
      `${prefix}publishAzureFunction`,
      `${prefix}startAzureFunctionHost`,
      `${prefix}sendTestContext`,
    ],
  },
  {
    id: "pluginDebugging",
    label: "Plug-in debugging (profiler)",
    note: "Profile next run, Download a run and Replay & debug depend on the org's Plugin Profiler and are not manually verified yet.",
    manualTestIssue: 224,
    projectTypes: [],
    commands: [
      `${prefix}capturePluginRun`,
      `${prefix}downloadPluginProfiles`,
      `${prefix}generatePluginReplayTest`,
      `${prefix}guidePluginProfiling`,
      // CodeLens-only command (not contributed in package.json) — the lens is gated too.
      `${prefix}toggleStepProfilingAtLine`,
    ],
  },
  {
    id: "customApis",
    label: "Custom APIs",
    note: "Definition, handler/client generation, deploy and invoke are not manually verified yet.",
    manualTestIssue: 225,
    projectTypes: [],
    commands: [`${prefix}newCustomApi`, `${prefix}generateCustomApiHandlers`, `${prefix}generateCustomApiClients`, `${prefix}deployCustomApis`, `${prefix}invokeCustomApi`],
  },
];

const PREVIEW_COMMANDS = new Set(PREVIEW_FEATURES.flatMap((feature) => [...feature.commands]));
const PREVIEW_PROJECT_TYPES = new Set(PREVIEW_FEATURES.flatMap((feature) => [...feature.projectTypes]));

/** True when this command belongs to a preview feature (hidden while the flag is off). */
export function isPreviewCommand(command: string | undefined): boolean {
  return command !== undefined && PREVIEW_COMMANDS.has(command);
}

/** True when the whole project type is a preview feature. */
export function isPreviewProjectType(type: string | undefined): boolean {
  return type !== undefined && PREVIEW_PROJECT_TYPES.has(type);
}

/** The feature a preview project type belongs to (for the "hidden component" notice). */
export function previewFeatureForProjectType(type: string | undefined): PreviewFeature | undefined {
  return PREVIEW_FEATURES.find((feature) => type !== undefined && feature.projectTypes.includes(type));
}

/** Drop preview project types from a picker (Add Component / new project) unless preview is on. */
export function visibleProjectTypes<T extends { id: string }>(types: readonly T[], previewEnabled: boolean): T[] {
  return previewEnabled ? [...types] : types.filter((type) => !isPreviewProjectType(type.id));
}

/** Drop preview actions from a menu row unless preview features are on. */
export function visibleActions<T extends { command: string }>(actions: readonly T[], previewEnabled: boolean): T[] {
  return previewEnabled ? [...actions] : actions.filter((action) => !isPreviewCommand(action.command));
}

/** Preview-gated `enablement`/`when` clause fragment used in package.json. Kept here so the
 * parity test can assert every preview command carries it. */
export const PREVIEW_WHEN_CLAUSE = "config.dataverse-powertools.previewFeatures";
