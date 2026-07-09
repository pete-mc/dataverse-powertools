import { describe, it, expect, afterEach } from "vitest";
import { pacInvocation } from "./pac";

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  delete process.env.ComSpec;
});

describe("pacInvocation", () => {
  it("runs pac directly on non-Windows platforms", () => {
    setPlatform("linux");
    expect(pacInvocation(["pages", "list"])).toEqual({ command: "pac", args: ["pages", "list"] });
  });

  it("routes through cmd.exe /c on Windows so a .cmd shim is never spawned directly", () => {
    setPlatform("win32");
    delete process.env.ComSpec;
    expect(pacInvocation(["auth", "list"])).toEqual({ command: "cmd.exe", args: ["/c", "pac", "auth", "list"] });
  });

  it("honours ComSpec when set", () => {
    setPlatform("win32");
    process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe";
    expect(pacInvocation(["modelbuilder", "build"]).command).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("passes pac arguments through untouched", () => {
    setPlatform("linux");
    const args = ["modelbuilder", "build", "--namespace", "My.Ns", "--outdirectory", "generated"];
    expect(pacInvocation(args).args).toEqual(args);
  });
});
