// Pure builders for `pac pcf` CLI argument arrays. No `vscode` import — keep it
// unit-testable, and keep the exact flags visible in one place so they're easy to
// verify against the pac reference:
// https://learn.microsoft.com/power-platform/developer/cli/reference/pcf
//
// Mirrors src/solution/pacArgs.ts.

/** Manifest-level template shape (`<property>` vs `<data-set>` in ControlManifest). */
export type PcfTemplate = "field" | "dataset";
/** Rendering framework: `none` (vanilla HTML/TS) or `react` (virtual/platform control). */
export type PcfFramework = "none" | "react";

export interface PcfInitOptions {
  template: PcfTemplate;
  framework: PcfFramework;
}

/**
 * `pac pcf init` — initialise a directory with a new PCF project.
 * `--template field|dataset`, `--framework none|react`. No auth required.
 */
export function pcfInitArgs({ template, framework }: PcfInitOptions): string[] {
  return ["pcf", "init", "--template", template, "--framework", framework];
}

/**
 * `pac pcf push` — import the PCF project into the current Dataverse organization
 * (fast, ephemeral dev inner loop). `--publisher-prefix` is the customization prefix.
 * Requires an active auth profile / selected environment.
 */
export function pcfPushArgs(publisherPrefix: string): string[] {
  return ["pcf", "push", "--publisher-prefix", publisherPrefix];
}
