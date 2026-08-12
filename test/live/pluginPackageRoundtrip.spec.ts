import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cp from "child_process";
import { loadLiveEnv, LiveEnv, testSolutionConfig } from "../liveEnv";
import { LiveDataverseClient } from "./dataverseClient";
import { upsertDataversePluginPackage, getDataversePluginPackageId } from "../../src/general/dataverse/getDataversePluginPackage";
import DataversePowerToolsContext from "../../src/context";

// Full plugin e2e the way the extension does it: scaffold a plugin project (pac plugin
// init), build it to a NuGet package (dotnet build, net462), then push it to the real
// environment via the extension's own upsertDataversePluginPackage (Web API), verify
// the package landed via the independent client, and delete it. Needs pac + dotnet, and
// self-skips (like the rest of the live tier) when either the creds or toolchain are absent.
const env = loadLiveEnv();

function has(tool: string, args: string[]): boolean {
  try {
    cp.execFileSync(tool, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const toolchain = has("dotnet", ["--version"]) && has("pac", ["help"]);

it(env && toolchain ? "live env + pac/dotnet available for plugin round-trip" : "plugin round-trip skipped (needs creds + pac + dotnet)", () => {
  expect(true).toBe(true);
});

const live = env && toolchain ? describe : describe.skip;

function fakeContext(url: string, token: string): DataversePowerToolsContext {
  return {
    dataverse: { organizationUrl: url, isValid: true, getAuthorizationToken: async () => token },
    channel: { appendLine: () => undefined, show: () => undefined },
  } as unknown as DataversePowerToolsContext;
}

live("plugin build + package push round-trip (pac init + dotnet build -> extension push -> verify -> delete)", () => {
  const client = new LiveDataverseClient(env as LiveEnv);
  const prefix = testSolutionConfig(env).prefix;
  const stamp = Date.now();
  const projectName = `${prefix}_testplugin${stamp}`;
  const uniqueName = `${prefix}_testpkg${stamp}`;
  let projectDir = "";
  let nupkgPath = "";
  let packageId: string | undefined;

  beforeAll(async () => {
    await client.connect();
    projectDir = path.join(os.tmpdir(), projectName);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });

    // Scaffold + build the plugin (pac plugin init names the project after the dir).
    cp.execFileSync("pac", ["plugin", "init"], { cwd: projectDir, stdio: "ignore" });
    cp.execFileSync("dotnet", ["build", "-c", "Release"], { cwd: projectDir, stdio: "ignore" });

    const releaseDir = path.join(projectDir, "bin", "Release");
    const nupkg = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir).find((f) => f.endsWith(".nupkg")) : undefined;
    nupkgPath = nupkg ? path.join(releaseDir, nupkg) : "";
  }, 300000);

  afterAll(async () => {
    if (packageId) {
      await client.deletePluginPackage(packageId);
    }
    if (projectDir) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("scaffolds and builds a net462 plugin to a NuGet package", () => {
    expect(nupkgPath, "no .nupkg produced by dotnet build").toBeTruthy();
    expect(fs.existsSync(nupkgPath)).toBe(true);
  });

  it("pushes the package via the extension's upsertDataversePluginPackage and it lands in Dataverse", async () => {
    const ctx = fakeContext((env as LiveEnv).url, client.accessToken);
    const result = await upsertDataversePluginPackage(ctx, { name: projectName, uniqueName, version: "1.0.0" }, nupkgPath);
    packageId = result.pluginPackageId;

    expect(result.pluginPackageId, "no plugin package id returned").toBeTruthy();
    expect(result.created).toBe(true);

    // Verify the package landed by the id the push returned (robust to any
    // publisher-prefix normalisation Dataverse applies to the unique name).
    const found = await client.getPluginPackageById(packageId as string);
    expect(found, "plugin package not found in Dataverse after push").toBeTruthy();

    // The extension's own lookup should resolve the (possibly normalised) unique name.
    expect(await getDataversePluginPackageId(ctx, found?.uniquename ?? uniqueName)).toBe(packageId);
  });
});
