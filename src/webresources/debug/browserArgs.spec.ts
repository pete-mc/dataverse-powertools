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
});
