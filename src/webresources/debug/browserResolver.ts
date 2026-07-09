import * as path from "path";

// Resolve a Chromium-based browser (Edge or Chrome) to drive under CDP for the
// "Debug Web Resources" flow. Pure and platform-parameterised so it unit-tests on any
// OS. Edge is preferred (it ships with Windows and is the currently-verified browser);
// Chrome is supported as a fallback.

export type BrowserKind = "msedge" | "chrome";
export type BrowserPreference = "auto" | BrowserKind;

export interface ResolvedBrowser {
  kind: BrowserKind;
  executablePath: string;
}

export interface BrowserResolverEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** Whether an executable path exists (injected so this stays pure/testable). */
  exists: (candidatePath: string) => boolean;
}

function winProgramDirs(env: Record<string, string | undefined>): string[] {
  return [env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA].filter((d): d is string => !!d);
}

function edgeCandidates(e: BrowserResolverEnv): string[] {
  switch (e.platform) {
    case "win32":
      return winProgramDirs(e.env).map((d) => path.win32.join(d, "Microsoft", "Edge", "Application", "msedge.exe"));
    case "darwin":
      return ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
    default:
      return ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/opt/microsoft/msedge/msedge"];
  }
}

function chromeCandidates(e: BrowserResolverEnv): string[] {
  switch (e.platform) {
    case "win32":
      return winProgramDirs(e.env).map((d) => path.win32.join(d, "Google", "Chrome", "Application", "chrome.exe"));
    case "darwin":
      return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
    default:
      return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  }
}

/** Search order for "auto"/preference: the preferred browser first, then the other. */
function searchOrder(prefer: BrowserPreference): BrowserKind[] {
  if (prefer === "chrome") {
    return ["chrome", "msedge"];
  }
  // "auto" and "msedge" both prefer Edge first.
  return ["msedge", "chrome"];
}

/**
 * Resolve the browser to launch. An explicit `overridePath` (from settings) wins when
 * it exists. Otherwise the first installed browser in preference order is returned.
 * Throws a clear, actionable error when nothing is found.
 */
export function resolveBrowser(prefer: BrowserPreference, overridePath: string | undefined, e: BrowserResolverEnv): ResolvedBrowser {
  if (overridePath && e.exists(overridePath)) {
    // Trust the configured preference for how to attach the debugger; default to Edge.
    return { kind: prefer === "chrome" ? "chrome" : "msedge", executablePath: overridePath };
  }

  for (const kind of searchOrder(prefer)) {
    const candidates = kind === "msedge" ? edgeCandidates(e) : chromeCandidates(e);
    const found = candidates.find((c) => e.exists(c));
    if (found) {
      return { kind, executablePath: found };
    }
  }

  throw new Error(
    "No supported browser found for debugging web resources. Install Microsoft Edge (recommended) or Google Chrome, " +
      "or set 'dataverse-powertools.debugBrowserPath' to the browser executable.",
  );
}
