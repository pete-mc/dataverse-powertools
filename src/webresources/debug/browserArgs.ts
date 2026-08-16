// Pure builder for the Chromium launch arguments. Kept separate so the exact flags are
// unit-tested and reviewable in one place.

export interface BrowserLaunchOptions {
  /** CDP remote-debugging port (both our interceptor and VS Code's debugger attach here). */
  port: number;
  /** Persistent profile dir so the Dataverse login survives between debug sessions. */
  userDataDir: string;
  /** Initial URL to open (the org). */
  url: string;
  /**
   * Extra Chromium flags from `dataverse-powertools.debugBrowserArgs`. An escape hatch for
   * environments whose browser needs a flag we deliberately don't ship as a default — the
   * motivating case is Ubuntu 23.10+/24.04, which restricts unprivileged user namespaces via
   * AppArmor so Chromium's sandbox can't start ("No usable sandbox!") and the process dies
   * before CDP listens; `--no-sandbox` fixes it there. That is NOT a default: it would weaken
   * the sandbox for every Linux user, including the majority who aren't affected, on a browser
   * pointed at their live org. Opt in per machine instead.
   */
  extraArgs?: string[];
}

/**
 * Build the browser command-line args. A dedicated `--user-data-dir` is required —
 * Chromium refuses remote debugging on the default profile — and it doubles as the
 * persistent login profile.
 */
export function buildBrowserArgs(options: BrowserLaunchOptions): string[] {
  return [
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${options.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Keep the app fully live while it sits behind VS Code: Chromium throttles background tabs'
    // timers/rendering, which stalls the model-driven app (and even the sign-in) when the browser
    // isn't the focused window. These keep hot-reload and the live app responsive when backgrounded.
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    // User flags go after ours so they can override an earlier one, but before the URL —
    // Chromium treats the first non-flag argument as the page to open.
    ...(options.extraArgs ?? []),
    "--new-window",
    options.url,
  ];
}
