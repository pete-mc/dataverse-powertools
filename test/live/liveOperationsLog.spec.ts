import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cp from "child_process";
import { loadLiveEnv, LiveEnv, testSolutionConfig } from "../liveEnv";
import { LiveDataverseClient } from "./dataverseClient";
import { DataverseContext } from "../../src/general/dataverse/dataverseContext";
import { DataverseWebresource } from "../../src/general/dataverse/DataverseWebresource";
import { upsertDataversePluginPackage } from "../../src/general/dataverse/getDataversePluginPackage";

// Runs real operations against the env through the extension's own code using a REAL
// DataverseContext (service-principal connect), and captures what the extension writes
// to its "Dataverse PowerTools" channel — proving the operations succeed AND producing
// the actual log output. Writes it to sandbox/screenshots-out/live-operations.log.
const env = loadLiveEnv();

function has(tool: string, args: string[]): boolean {
  try {
    cp.execFileSync(tool, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const toolchain = has("pac", ["help"]) && has("dotnet", ["--version"]);

it(env && toolchain ? "live env + pac/dotnet available for operations log" : "operations log skipped (needs creds + pac + dotnet)", () => {
  expect(true).toBe(true);
});

const live = env && toolchain ? describe : describe.skip;

live("live operations log (real connect + webresource push + plugin push, captured channel)", () => {
  const e = env as LiveEnv;
  const client = new LiveDataverseClient(e);
  const cfg = testSolutionConfig(e);
  const stamp = Date.now();
  const log: string[] = [];
  // A real DataverseContext, with just enough surrounding context for it to run.
  const context: any = {
    connectionString: `AuthType=ClientSecret;Url=${e.url};ClientId=${e.clientId};ClientSecret=${e.clientSecret}`,
    projectSettings: { tenantId: e.tenantId },
    channel: { appendLine: (m: string) => log.push(String(m)), show: () => undefined },
    setStatusBar: () => undefined,
  };
  const wrName = `${cfg.prefix}_dvptlog_${stamp}.js`;
  const pkgUnique = `${cfg.prefix}_dvptlogpkg${stamp}`;
  let projectDir = "";
  let nupkgPath = "";
  let webresourceId: string | undefined;
  let packageId: string | undefined;

  beforeAll(async () => {
    await client.connect();
    await client.ensureTestSolution(cfg);
    context.dataverse = new DataverseContext(context);

    projectDir = path.join(os.tmpdir(), `${cfg.prefix}_dvptlogplugin${stamp}`);
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir, { recursive: true });
    cp.execFileSync("pac", ["plugin", "init"], { cwd: projectDir, stdio: "ignore" });
    cp.execFileSync("dotnet", ["build", "-c", "Release"], { cwd: projectDir, stdio: "ignore" });
    const releaseDir = path.join(projectDir, "bin", "Release");
    const nupkg = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir).find((f) => f.endsWith(".nupkg")) : undefined;
    nupkgPath = nupkg ? path.join(releaseDir, nupkg) : "";
  }, 300000);

  afterAll(async () => {
    const outDir = path.resolve(__dirname, "..", "..", "sandbox", "screenshots-out");
    fs.mkdirSync(outDir, { recursive: true });
    const header = [`Dataverse PowerTools — live operations log`, `Environment: ${e.url}`, `Run: ${new Date().toISOString()}`, "".padEnd(60, "-")];
    fs.writeFileSync(path.join(outDir, "live-operations.log"), header.concat(log).join("\n") + "\n");
    if (webresourceId) {
      await client.deleteWebresource(webresourceId);
    }
    if (packageId) {
      await client.deletePluginPackage(packageId);
    }
    if (projectDir) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("connects to the real environment (logs 'Connected to Dataverse')", async () => {
    const ok = await context.dataverse.initialize(true);
    expect(ok, "could not connect to the live environment").toBe(true);
    expect(log.some((l) => l.includes("Connected to Dataverse"))).toBe(true);
  });

  it("pushes a webresource and logs the success", async () => {
    const source = `console.log("dvpt live-log ${stamp}");`;
    const webresource = new DataverseWebresource(wrName, context);
    await webresource.upsert(Buffer.from(source, "utf8").toString("base64"), 3, "dvpt live-log test");
    await webresource.addToSolution(cfg.solutionUniqueName);

    webresourceId = (await client.findWebresourceByName(wrName))?.webresourceid;
    expect(webresourceId, "webresource not found after push").toBeTruthy();
    expect(log.some((l) => l.includes(`Webresource '${wrName}' created`))).toBe(true);
    expect(log.some((l) => l.includes(`Added webresource '${wrName}' to solution`))).toBe(true);
  });

  it("pushes a plugin package and logs the success", async () => {
    expect(nupkgPath, "no nupkg built").toBeTruthy();
    const result = await upsertDataversePluginPackage(context, { name: pkgUnique, uniqueName: pkgUnique, version: "1.0.0" }, nupkgPath);
    packageId = result.pluginPackageId;
    expect(packageId, "plugin package not created").toBeTruthy();
    expect(log.some((l) => l.includes(`Plugin package '${pkgUnique}'`) && l.includes("created"))).toBe(true);
  });
});
