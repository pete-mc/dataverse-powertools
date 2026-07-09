import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cp from "child_process";
import { loadLiveEnv, LiveEnv, testSolutionConfig } from "../liveEnv";
import { LiveDataverseClient } from "./dataverseClient";
import { upsertDataversePluginPackage } from "../../src/general/dataverse/getDataversePluginPackage";
import { pacInvocation } from "../../src/general/pac";
import DataversePowerToolsContext from "../../src/context";

// Command-level end-to-end for the plugin lifecycle with no editor UI: scaffold a plugin
// project (pac plugin init), generate early-bound classes with pac modelbuilder THROUGH
// the extension's pacInvocation helper (the path that had the `spawn EINVAL` bug),
// build it to a net462 NuGet package (dotnet build), then push it via the extension's
// own upsertDataversePluginPackage and verify it landed. Self-skips without creds +
// pac + dotnet. Interference-free (no Selenium/desktop).
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

it(env && toolchain ? "live env + pac/dotnet available for plugin lifecycle" : "plugin lifecycle skipped (needs creds + pac + dotnet)", () => {
  expect(true).toBe(true);
});

const live = env && toolchain ? describe : describe.skip;

function fakeContext(url: string, token: string): DataversePowerToolsContext {
  return {
    dataverse: { organizationUrl: url, isValid: true, getAuthorizationToken: async () => token },
    channel: { appendLine: () => undefined, show: () => undefined },
  } as unknown as DataversePowerToolsContext;
}

live("plugin lifecycle (init -> early-bound -> build -> push -> verify)", () => {
  const e = env as LiveEnv;
  const client = new LiveDataverseClient(e);
  const cfg = testSolutionConfig(e);
  const stamp = Date.now();
  const projectName = `${cfg.prefix}_testplugin${stamp}`;
  const uniqueName = `${cfg.prefix}_testpkg${stamp}`;
  const authProfile = `dvpt-plugin-test-${stamp}`;
  let projectDir = "";
  let nupkgPath = "";
  let packageId: string | undefined;

  beforeAll(async () => {
    await client.connect();
    projectDir = path.join(os.tmpdir(), projectName);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    cp.execFileSync("pac", ["plugin", "init"], { cwd: projectDir, stdio: "ignore" });
    // pac modelbuilder uses the active pac auth profile.
    cp.execFileSync(
      "pac",
      ["auth", "create", "--name", authProfile, "--url", e.url, "--applicationId", e.clientId, "--clientSecret", e.clientSecret, "--tenant", e.tenantId],
      { stdio: "ignore" },
    );
  }, 300000);

  afterAll(async () => {
    if (packageId) {
      try {
        await client.deletePluginPackage(packageId);
      } catch {
        /* ignore */
      }
    }
    try {
      cp.execFileSync("pac", ["auth", "delete", "--name", authProfile], { stdio: "ignore" });
    } catch {
      /* ignore */
    }
    if (projectDir) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("generates early-bound classes via pac modelbuilder (through the cmd.exe /c pac invocation)", () => {
    const outDir = "earlybound";
    const args = ["modelbuilder", "build", "--namespace", "Dvpt.Plugin.Test", "--serviceContextName", "XrmSvc", "--outdirectory", outDir, "--entityNamesFilter", "account"];
    const inv = pacInvocation(args); // the exact invocation path that used to throw spawn EINVAL
    cp.execFileSync(inv.command, inv.args, { cwd: projectDir, stdio: "ignore", timeout: 180000 });
    const generatedDir = path.join(projectDir, outDir);
    const csFiles = fs.existsSync(generatedDir) ? fs.readdirSync(generatedDir).filter((f) => f.endsWith(".cs")) : [];
    expect(csFiles.length, "no early-bound .cs files generated").toBeGreaterThan(0);
  }, 180000);

  it("builds the plugin (with the early-bound classes) to a net462 NuGet package", () => {
    cp.execFileSync("dotnet", ["build", "-c", "Release"], { cwd: projectDir, stdio: "pipe", timeout: 300000 });
    const releaseDir = path.join(projectDir, "bin", "Release");
    const nupkg = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir).find((f) => f.endsWith(".nupkg")) : undefined;
    nupkgPath = nupkg ? path.join(releaseDir, nupkg) : "";
    expect(nupkgPath, "no .nupkg produced by dotnet build").toBeTruthy();
    expect(fs.existsSync(nupkgPath)).toBe(true);
  }, 300000);

  it("pushes the package via the extension and verifies it in Dataverse", async () => {
    const ctx = fakeContext(e.url, client.accessToken);
    const result = await upsertDataversePluginPackage(ctx, { name: projectName, uniqueName, version: "1.0.0" }, nupkgPath);
    packageId = result.pluginPackageId;
    expect(result.pluginPackageId, "no plugin package id returned").toBeTruthy();
    const found = await client.getPluginPackageById(packageId as string);
    expect(found, "plugin package not found in Dataverse after push").toBeTruthy();
  }, 120000);
});
