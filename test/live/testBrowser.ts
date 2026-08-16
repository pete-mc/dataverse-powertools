import * as fs from "fs";
import { resolveBrowser, BrowserPreference, ResolvedBrowser } from "../../src/webresources/debug/browserResolver";

// How the LIVE/e2e harness finds and launches a Chromium to drive under CDP.
//
// Two things differ from a developer's machine, and both bite only off-Windows:
//
// 1. A headless Linux box (CI, or a container) often has no system Edge or Chrome at all — only a
//    Chromium unpacked by some other tool into a version-stamped directory that moves whenever it
//    is upgraded. Such a path can't be found by probing the usual install locations, so it is
//    CONFIGURED via DVPT_TEST_BROWSER_PATH rather than guessed. A normal dev machine sets nothing
//    and falls through to the extension's own resolver.
// 2. Ubuntu 23.10+ restricts unprivileged user namespaces via AppArmor, so Chromium's sandbox
//    cannot start and the process dies with "No usable sandbox!" before its CDP port ever listens.
//
// The product deliberately does NOT default those flags on (see browserArgs.ts and the
// `dataverse-powertools.debugBrowserArgs` setting) — weakening the sandbox for every Linux user
// would be a real regression. This is harness code, so it applies them itself.

/**
 * Resolve the browser the harness should drive, or undefined when there is none — callers
 * self-skip on undefined rather than failing, so a box without a browser reports "skipped"
 * instead of a red that looks like a product fault.
 */
export function resolveTestBrowser(prefer: BrowserPreference = "auto"): ResolvedBrowser | undefined {
  const override = process.env.DVPT_TEST_BROWSER_PATH || undefined;
  try {
    return resolveBrowser(prefer, override, { platform: process.platform, env: process.env, exists: fs.existsSync });
  } catch {
    return undefined;
  }
}

/** Extra Chromium flags this platform's harness needs. Empty everywhere but Linux. */
export function testBrowserArgs(): string[] {
  return process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : [];
}
