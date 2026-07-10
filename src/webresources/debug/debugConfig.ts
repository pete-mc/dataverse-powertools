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

export function buildAttachDebugConfig(browserKind: BrowserKind, port: number): AttachDebugConfig {
  return {
    type: browserKind === "chrome" ? "chrome" : "msedge",
    request: "attach",
    name: "Dataverse PowerTools: Debug Web Resources",
    port,
    webRoot: "${workspaceFolder}",
    sourceMapPathOverrides: {
      "webpack://*": "${workspaceFolder}/*",
      "webpack:///./*": "${workspaceFolder}/*",
    },
  };
}
