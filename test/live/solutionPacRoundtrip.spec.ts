import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cp from "child_process";
import { loadLiveEnv, LiveEnv, testSolutionConfig } from "../liveEnv";
import { pacAuthCreateArgs, pacAuthDeleteArgs, pacSolutionExportArgs, pacSolutionUnpackArgs, pacSolutionPackArgs } from "../../src/solution/pacArgs";
import { SolutionConfig } from "../../src/solution/solutionConfig";

// Drives the extension's own pac argument builders (pacArgs) against real `pac`:
// authenticate as the service principal, EXPORT the dedicated test solution from the
// env, UNPACK the zip to a folder, then PACK it back to a zip — the full solution
// round-trip. Verifies the artifacts and cleans up. Self-skips without creds or pac.
const env = loadLiveEnv();

function hasPac(): boolean {
  try {
    cp.execFileSync("pac", ["help"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const toolchain = hasPac();

/** Run pac, redacting the client secret from any error surfaced. */
function runPac(args: string[], cwd: string, secret?: string): void {
  try {
    cp.execFileSync("pac", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e: any) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""} ${e.message ?? ""}`;
    throw new Error(secret ? out.split(secret).join("***") : out);
  }
}

it(env && toolchain ? "live env + pac available for solution round-trip" : "solution round-trip skipped (needs creds + pac)", () => {
  expect(true).toBe(true);
});

const live = env && toolchain ? describe : describe.skip;

live("solution export + unpack + pack round-trip (extension pacArgs -> real pac -> env)", () => {
  const e = env as LiveEnv;
  const profileName = "dvpttest_soln_e2e";
  const solutionUniqueName = testSolutionConfig(e).solutionUniqueName;
  let tmpDir = "";
  let config: SolutionConfig;
  let repackedZip = "";

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt_soln_"));
    config = {
      uniqueName: solutionUniqueName,
      packagePath: path.join(tmpDir, "unpacked"),
      zipPath: path.join(tmpDir, `${solutionUniqueName}.zip`),
      packageType: "Unmanaged",
    };
    repackedZip = path.join(tmpDir, `${solutionUniqueName}_repacked.zip`);

    // Fresh auth profile for the test env.
    try {
      runPac(pacAuthDeleteArgs(profileName), tmpDir);
    } catch {
      /* profile may not exist */
    }
    runPac(pacAuthCreateArgs({ profileName, applicationId: e.clientId, clientSecret: e.clientSecret, tenantId: e.tenantId, environmentUrl: e.url }), tmpDir, e.clientSecret);

    runPac(pacSolutionExportArgs(config, { managed: false, environmentUrl: e.url }), tmpDir);
    runPac(pacSolutionUnpackArgs(config), tmpDir);
    runPac(pacSolutionPackArgs({ ...config, zipPath: repackedZip }), tmpDir);
  }, 300000);

  afterAll(() => {
    try {
      runPac(pacAuthDeleteArgs(profileName), tmpDir);
    } catch {
      /* ignore */
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("exports the solution zip from the environment", () => {
    expect(fs.existsSync(config.zipPath), "exported solution zip missing").toBe(true);
  });

  it("unpacks the zip to a Solution.xml", () => {
    expect(fs.existsSync(path.join(config.packagePath, "Other", "Solution.xml")), "unpacked Solution.xml missing").toBe(true);
  });

  it("packs the folder back into a zip", () => {
    expect(fs.existsSync(repackedZip), "repacked solution zip missing").toBe(true);
  });
});
