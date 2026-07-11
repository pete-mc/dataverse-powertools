// Pure builder for the Chromium launch arguments. Kept separate so the exact flags are
// unit-tested and reviewable in one place.

export interface BrowserLaunchOptions {
  /** CDP remote-debugging port (both our interceptor and VS Code's debugger attach here). */
  port: number;
  /** Persistent profile dir so the Dataverse login survives between debug sessions. */
  userDataDir: string;
  /** Initial URL to open (the org). */
  url: string;
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
    "--new-window",
    options.url,
  ];
}
