import { describe, it, expect } from "vitest";
import { buildBrowserArgs } from "./browserArgs";

describe("buildBrowserArgs", () => {
  it("builds the CDP + persistent-profile launch args with the url last", () => {
    const args = buildBrowserArgs({ port: 9333, userDataDir: "C:\\profiles\\dvpt", url: "https://org.crm.dynamics.com" });
    expect(args).toEqual([
      "--remote-debugging-port=9333",
      "--user-data-dir=C:\\profiles\\dvpt",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--new-window",
      "https://org.crm.dynamics.com",
    ]);
  });

  it("keeps the remote-debugging port first and the url last", () => {
    const args = buildBrowserArgs({ port: 5000, userDataDir: "/tmp/p", url: "https://x" });
    expect(args[0]).toBe("--remote-debugging-port=5000");
    expect(args[args.length - 1]).toBe("https://x");
    // Anti-throttling flags keep the backgrounded app/hot-reload live behind VS Code.
    expect(args).toContain("--disable-background-timer-throttling");
  });

  // `dataverse-powertools.debugBrowserArgs` — the opt-in escape hatch for browsers that need a
  // flag we refuse to ship as a default (the Ubuntu 23.10+ AppArmor "No usable sandbox!" case).
  it("appends extraArgs, still before the url", () => {
    const args = buildBrowserArgs({ port: 1, userDataDir: "/tmp/p", url: "https://x", extraArgs: ["--no-sandbox", "--disable-dev-shm-usage"] });
    expect(args[args.length - 1]).toBe("https://x");
    expect(args).toContain("--no-sandbox");
    // Chromium takes the first non-flag argument as the page to open, so every user flag must
    // land ahead of the URL or it would be swallowed as a second page.
    expect(args.indexOf("--no-sandbox")).toBeLessThan(args.indexOf("https://x"));
  });

  it("sends no sandbox-weakening flag by default, on any platform", () => {
    const args = buildBrowserArgs({ port: 1, userDataDir: "/tmp/p", url: "https://x" });
    expect(args).not.toContain("--no-sandbox");
    expect(args).not.toContain("--disable-dev-shm-usage");
  });
});
