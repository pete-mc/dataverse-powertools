/* eslint-disable @typescript-eslint/naming-convention */ // source-map override keys mirror webpack's path format.
import type { BrowserKind } from "./browserResolver";

// Pure builder for the VS Code js-debug "attach" configuration. Structurally a
// vscode.DebugConfiguration, but defined locally so this module stays vscode-free
// (and unit-testable). VS Code's built-in JS debugger attaches to the same
// remote-debugging port the browser was launched with, so breakpoints hit the original
// TypeScript via the bundle's inline source maps.

export interface AttachDebugConfig {
  type: "msedge" | "chrome";
  request: "attach";
  name: string;
  port: number;
  webRoot: string;
  /** Map the served bundle's source-map paths back to the workspace. */
  sourceMapPathOverrides?: Record<string, string>;
}

/**
 * @param webRoot absolute project (component) root — NOT ${workspaceFolder}, so
 *   subfolder components map correctly.
 * @param libraryNamespace webpack 5 prefixes module paths with the output
 *   library name (`webpack://<namespace>/./webresources_src/...`) — without an
 *   override for that exact shape, breakpoints show "unbound" (user report).
 *   Pass the solution prefix (the template's library name).
 */
export function buildAttachDebugConfig(browserKind: BrowserKind, port: number, webRoot: string = "${workspaceFolder}", libraryNamespace?: string): AttachDebugConfig {
  const overrides: Record<string, string> = {
    // webpack 5 namespace form (library name = solution prefix).
    ...(libraryNamespace ? { [`webpack://${libraryNamespace}/./*`]: `${webRoot}/*`, [`webpack://${libraryNamespace}/*`]: `${webRoot}/*` } : {}),
    // Generic namespace wildcard (js-debug's ?:* matches any namespace).
    "webpack://?:*/./*": `${webRoot}/*`,
    "webpack://?:*/*": `${webRoot}/*`,
    // Namespace-less forms (webpack 4-style / devtool variants).
    "webpack:///./*": `${webRoot}/*`,
    "webpack://*": `${webRoot}/*`,
  };
  return {
    type: browserKind === "chrome" ? "chrome" : "msedge",
    request: "attach",
    name: "Dataverse PowerTools: Debug Web Resources",
    port,
    webRoot,
    sourceMapPathOverrides: overrides,
  };
}

/** Whether one sourceMapPathOverrides pattern matches a source-map source URL
 * (js-debug semantics: `*` is the only wildcard, everything else literal).
 * Pure — the e2e suites assert the ACTUAL built bundle's source names match
 * our overrides, so a template/devtool drift can't silently unbind breakpoints. */
export function overridePatternMatches(pattern: string, source: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  );
  return regex.test(source);
}

/** True when ANY override pattern claims the given source URL. */
export function anyOverrideMatches(overrides: Record<string, string> | undefined, source: string): boolean {
  return Object.keys(overrides ?? {}).some((pattern) => overridePatternMatches(pattern, source));
}
