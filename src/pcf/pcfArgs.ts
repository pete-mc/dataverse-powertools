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
  /** `<control namespace="…">`. Dotted segments allowed (`Contoso.Controls`). */
  namespace?: string;
  /** `<control constructor="…">` — the control name. */
  name?: string;
}

/** A single C#/TS-style identifier segment — what pac accepts for a control name. */
const PCF_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A namespace: one or more identifier segments joined by dots. */
const PCF_NAMESPACE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** Whether `value` is usable as a `pac pcf init --name`. */
export function isValidPcfName(value: string): boolean {
  return PCF_NAME_PATTERN.test(value);
}

/** Whether `value` is usable as a `pac pcf init --namespace`. */
export function isValidPcfNamespace(value: string): boolean {
  return PCF_NAMESPACE_PATTERN.test(value);
}

/**
 * `pac pcf init` — initialise a directory with a new PCF project.
 * `--template field|dataset`, `--framework none|react`. No auth required.
 *
 * `namespace`/`name` are the only user-supplied text that reaches this argv (#258). They are
 * validated here as well as in the prompt's `validateInput`: the prompt is the usable check, this
 * is the backstop that means no caller can put arbitrary text on the command line. pac is spawned
 * with an args array and no shell (src/general/pac.ts), so this is about pac rejecting a malformed
 * name — not about shell injection — but a name that fails here would otherwise fail deep inside
 * the scaffold with a pac error instead of at the point it was chosen.
 */
export function pcfInitArgs({ template, framework, namespace, name }: PcfInitOptions): string[] {
  const args = ["pcf", "init", "--template", template, "--framework", framework];
  if (namespace !== undefined) {
    if (!isValidPcfNamespace(namespace)) {
      throw new Error(`PCF namespace ${JSON.stringify(namespace)} is not valid — letters, digits and underscores, dot-separated, not starting with a digit.`);
    }
    args.push("--namespace", namespace);
  }
  if (name !== undefined) {
    if (!isValidPcfName(name)) {
      throw new Error(`PCF control name ${JSON.stringify(name)} is not valid — letters, digits and underscores, not starting with a digit.`);
    }
    args.push("--name", name);
  }
  return args;
}

/**
 * `pac pcf push` — import the PCF project into the current Dataverse organization
 * (fast, ephemeral dev inner loop). `--publisher-prefix` is the customization prefix.
 * Requires an active auth profile / selected environment.
 */
export function pcfPushArgs(publisherPrefix: string): string[] {
  return ["pcf", "push", "--publisher-prefix", publisherPrefix];
}
