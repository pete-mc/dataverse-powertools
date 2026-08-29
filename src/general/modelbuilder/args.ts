import { PluginModelBuilderSettings } from "../../context";

// Pure argv builder for `pac modelbuilder build`, mirroring src/solution/pacArgs.ts and
// generateTypings' buildTypingsArgs: the exact flags live in one unit-tested place so they can be
// checked against the pac reference without an org.
//
// https://learn.microsoft.com/power-platform/developer/cli/reference/modelbuilder

/**
 * `--entitynamesfilter` and `--messagenamesfilter` are SEMICOLON separated. pac's own help:
 *
 *   --entitynamesfilter   Passed in as a semicolon separated list.
 *                         Using the form <entitylogicalname>;<entitylogicalname>
 *   --messagenamesfilter  Passed in as a semicolon separated list ...
 *                         Using the form <messagename>;<messagename>
 *
 * These were joined with "," which pac 2.8.1 treats as ONE entity name that matches nothing: it
 * reports "Read 0 Entities", writes no classes, and STILL EXITS 0 — so the command looked like it
 * succeeded and left an empty generated folder, and a later Build & deploy shipped a package with
 * no early-bound classes. Verified against 2.8.1+ga4eb71c: "team,teamtemplate" -> 0 entities;
 * "team;teamtemplate" -> "Read 2 Entities".
 *
 * The comma form remains the SETTINGS/UI format (settingsFile parses CSV, the pickers display CSV);
 * only the CLI boundary is semicolon-separated.
 */
export const PAC_FILTER_SEPARATOR = ";";

/** Join a filter list the way pac expects, dropping blanks so a stray comma can't emit an empty name. */
export function joinPacFilter(values: string[]): string {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(PAC_FILTER_SEPARATOR);
}

/**
 * argv for `pac modelbuilder build` from the component's settings (the leading "pac" is added by
 * the runner). Returns only the flags the settings actually populate.
 */
export function buildModelBuilderArgs(settings: PluginModelBuilderSettings): string[] {
  const args = [
    "modelbuilder",
    "build",
    "--namespace",
    settings.namespace ?? "",
    "--serviceContextName",
    settings.serviceContextName ?? "",
    "--outdirectory",
    settings.outputDirectory ?? "",
  ];

  const entityFilter = joinPacFilter(settings.entityNamesFilter ?? []);
  if (entityFilter) {
    args.push("--entityNamesFilter", entityFilter);
  }
  if (settings.entityTypesFolder) {
    args.push("--entityTypesFolder", settings.entityTypesFolder);
  }
  const messageFilter = joinPacFilter(settings.messageNamesFilter ?? []);
  if (messageFilter) {
    args.push("--messageNamesFilter", messageFilter);
  }
  if (settings.messagesTypesFolder) {
    args.push("--messagesTypesFolder", settings.messagesTypesFolder);
  }
  if (settings.optionSetsTypesFolder) {
    args.push("--optionSetsTypesFolder", settings.optionSetsTypesFolder);
  }
  if (settings.emitEntityEtc) {
    args.push("--emitEntityETC");
  }
  if (settings.emitFieldsClasses) {
    args.push("--emitFieldsClasses");
  }
  if (settings.emitVirtualAttributes) {
    args.push("--emitVirtualAttributes");
  }
  if (settings.generateGlobalOptionSets) {
    args.push("--generateGlobalOptionSets");
  }
  if (settings.generateSdkMessages) {
    args.push("--generateSdkMessages");
  }
  if (settings.logLevel) {
    args.push("--logLevel", settings.logLevel);
  }
  if (settings.suppressGeneratedCodeAttribute) {
    args.push("--suppressGeneratedCodeAttribute");
  }
  if (settings.suppressINotifyPattern) {
    args.push("--suppressINotifyPattern");
  }
  return args;
}
