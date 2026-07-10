/* eslint-disable @typescript-eslint/naming-convention */ // Windows env-var names (ProgramFiles, LOCALAPPDATA) must match the real names.
import { describe, it, expect } from "vitest";
import { resolveBrowser, BrowserResolverEnv } from "./browserResolver";

function envWith(platform: NodeJS.Platform, existing: string[], env: Record<string, string | undefined> = {}): BrowserResolverEnv {
  const set = new Set(existing);
  return { platform, env, exists: (p) => set.has(p) };
}

const winEnv = {
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
  LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
};
const edgeWin = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const chromeWin = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

describe("resolveBrowser", () => {
  it("prefers Edge on Windows when both are installed (auto)", () => {
    const r = resolveBrowser("auto", undefined, envWith("win32", [edgeWin, chromeWin], winEnv));
    expect(r).toEqual({ kind: "msedge", executablePath: edgeWin });
  });

  it("falls back to Chrome when Edge is absent", () => {
    const r = resolveBrowser("auto", undefined, envWith("win32", [chromeWin], winEnv));
    expect(r).toEqual({ kind: "chrome", executablePath: chromeWin });
  });

  it("honours a chrome preference when Chrome is installed", () => {
    const r = resolveBrowser("chrome", undefined, envWith("win32", [edgeWin, chromeWin], winEnv));
    expect(r.kind).toBe("chrome");
    expect(r.executablePath).toBe(chromeWin);
  });

  it("uses an explicit override path when it exists", () => {
    const custom = "D:\\browsers\\edge.exe";
    const r = resolveBrowser("auto", custom, envWith("win32", [custom, edgeWin], winEnv));
    expect(r.executablePath).toBe(custom);
  });

  it("ignores a missing override path and falls back to a real install", () => {
    const r = resolveBrowser("auto", "D:\\nope.exe", envWith("win32", [edgeWin], winEnv));
    expect(r.executablePath).toBe(edgeWin);
  });

  it("throws an actionable error when no browser is found", () => {
    expect(() => resolveBrowser("auto", undefined, envWith("win32", [], winEnv))).toThrow(/No supported browser/);
  });

  it("resolves the macOS Edge path", () => {
    const mac = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    const r = resolveBrowser("auto", undefined, envWith("darwin", [mac]));
    expect(r).toEqual({ kind: "msedge", executablePath: mac });
  });

  it("resolves a Linux Chrome path when Edge is absent", () => {
    const r = resolveBrowser("auto", undefined, envWith("linux", ["/usr/bin/google-chrome-stable"]));
    expect(r).toEqual({ kind: "chrome", executablePath: "/usr/bin/google-chrome-stable" });
  });
});
