import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pacInvocation, findPacExecutable, resetPacExecutableCache } from "./pac";

const originalPlatform = process.platform;
const originalPath = process.env.PATH;
const originalUserProfile = process.env.USERPROFILE;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

beforeEach(() => {
  resetPacExecutableCache();
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  process.env.PATH = originalPath;
  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = originalUserProfile;
  }
  delete process.env.ComSpec;
  resetPacExecutableCache();
});

describe("findPacExecutable", () => {
  it("returns the first PATH entry containing pac.exe", () => {
    // Platform-agnostic: CI runs POSIX, dev runs Windows — build with path.join/delimiter.
    const dirs = ["other", "tools", "more"].map((d) => path.join(os.tmpdir(), d));
    const hit = path.join(dirs[1], "pac.exe");
    const exists = (candidate: string) => candidate === hit;
    expect(findPacExecutable(dirs.join(path.delimiter), exists)).toBe(hit);
  });

  it("returns undefined when no entry has pac.exe (or PATH is empty)", () => {
    expect(findPacExecutable(["a", "b"].map((d) => path.join(os.tmpdir(), d)).join(path.delimiter), () => false)).toBeUndefined();
    expect(findPacExecutable(undefined, () => true)).toBeUndefined();
  });
});

describe("pacInvocation", () => {
  it("runs pac directly on non-Windows platforms", () => {
    setPlatform("linux");
    expect(pacInvocation(["pages", "list"])).toEqual({ command: "pac", args: ["pages", "list"] });
  });

  it("spawns a real pac.exe directly (no shell) when one is on PATH (#104)", () => {
    setPlatform("win32");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-pac-"));
    const exe = path.join(dir, "pac.exe");
    fs.writeFileSync(exe, "");
    process.env.PATH = dir;
    delete process.env.USERPROFILE;
    try {
      expect(pacInvocation(["auth", "list"])).toEqual({ command: exe, args: ["auth", "list"] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to cmd.exe /c on Windows when no pac.exe exists, so a .cmd shim is never spawned directly", () => {
    setPlatform("win32");
    process.env.PATH = "";
    delete process.env.USERPROFILE;
    delete process.env.ComSpec;
    expect(pacInvocation(["auth", "list"])).toEqual({ command: "cmd.exe", args: ["/c", "pac", "auth", "list"] });
  });

  it("uses a constant cmd.exe and ignores %ComSpec% so the spawned command can't be redirected by the environment", () => {
    setPlatform("win32");
    process.env.PATH = "";
    delete process.env.USERPROFILE;
    process.env.ComSpec = "C:\\attacker\\evil.exe";
    expect(pacInvocation(["modelbuilder", "build"]).command).toBe("cmd.exe");
  });

  it("passes pac arguments through untouched", () => {
    setPlatform("linux");
    const args = ["modelbuilder", "build", "--namespace", "My.Ns", "--outdirectory", "generated"];
    expect(pacInvocation(args).args).toEqual(args);
  });
});
