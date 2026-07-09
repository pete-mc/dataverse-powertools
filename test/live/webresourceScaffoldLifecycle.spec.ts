import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cp from "child_process";
import { loadLiveEnv, LiveEnv, testSolutionConfig } from "../liveEnv";
import { LiveDataverseClient } from "./dataverseClient";
import { DataverseContext } from "../../src/general/dataverse/dataverseContext";
import { DataverseWebresource } from "../../src/general/dataverse/DataverseWebresource";

// Command-level end-to-end for the Web Resources lifecycle, with NO editor UI: scaffold
// a project from the real templates/webresources template (same file-copy + placeholder
// substitution the wizard does), run the template's restore commands, run the webpack
// build, then deploy the built library through the extension's own code against the live
// env. This reaches the create -> restore -> build -> deploy path that unit tests can't,
// without Selenium/desktop interference. Self-skips without creds + toolchain.
const env = loadLiveEnv();

// Run through a shell so Windows .cmd shims (npm, webpack) resolve; constant commands.
function hasShell(command: string): boolean {
  try {
    cp.execSync(command, { stdio: "ignore", timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}
const toolchain = hasShell("npm --version") && hasShell("dotnet --version") && hasShell("webpack --version");

it(env && toolchain ? "live env + npm/dotnet/webpack available" : "webresource scaffold lifecycle skipped (needs creds + npm + dotnet + webpack)", () => {
  expect(true).toBe(true);
});

const live = env && toolchain ? describe : describe.skip;

/** Replicate generateTemplates: copy each template file, substituting placeholders. */
function scaffoldWebresourceProject(dir: string, prefix: string, solutionName: string): void {
  const templateDir = path.resolve(__dirname, "..", "..", "templates", "webresources");
  const template = JSON.parse(fs.readFileSync(path.join(templateDir, "template.json"), "utf8"))[0];
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of template.files) {
    const ext = f.extension === ".tstemplate" ? ".ts" : f.extension;
    let data = fs.readFileSync(path.join(templateDir, f.filename + f.extension, f.version + f.extension), "utf8");
    data = data.replace(/SOLUTIONPREFIX/g, prefix).replace(/SOLUTIONPLACEHOLDER/g, solutionName);
    const destPath = path.join(dir, ...(f.path as string[]), f.filename + ext);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, data, "utf8");
  }
}

function restoreCommands(): string[] {
  const templateDir = path.resolve(__dirname, "..", "..", "templates", "webresources");
  const template = JSON.parse(fs.readFileSync(path.join(templateDir, "template.json"), "utf8"))[0];
  return [...(template.initCommands ?? []), ...(template.restoreCommands ?? [])].map((c: { command: string }) => c.command);
}

live("web resources scaffold -> restore -> build -> deploy (command level)", () => {
  const e = env as LiveEnv;
  const client = new LiveDataverseClient(e);
  const cfg = testSolutionConfig(e);
  const libraryName = `${cfg.prefix}_library.js`;
  const log: string[] = [];
  const context: any = {
    connectionString: `AuthType=ClientSecret;Url=${e.url};ClientId=${e.clientId};ClientSecret=${e.clientSecret}`,
    projectSettings: { tenantId: e.tenantId },
    channel: { appendLine: (m: string) => log.push(String(m)), show: () => undefined },
    setStatusBar: () => undefined,
  };
  let projectDir = "";

  beforeAll(async () => {
    await client.connect();
    await client.ensureTestSolution(cfg);
    context.dataverse = new DataverseContext(context);
    await context.dataverse.initialize(true); // establish the live connection before deploy
    projectDir = path.join(os.tmpdir(), `dvpt_wr_scaffold_${Date.now()}`);
    scaffoldWebresourceProject(projectDir, cfg.prefix, cfg.solutionUniqueName);
  }, 60000);

  afterAll(async () => {
    try {
      const wr = await client.findWebresourceByName(libraryName);
      if (wr) {
        await client.deleteWebresource(wr.webresourceid);
      }
    } catch {
      /* ignore cleanup failure */
    }
    if (!process.env.DVPT_KEEP_PROJECT) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } else {
      console.log(`[e2e] kept project at ${projectDir}`);
    }
  });

  it("scaffolds a buildable project (library.ts stub, not export ./account)", () => {
    const library = fs.readFileSync(path.join(projectDir, "webresources_src", "library.ts"), "utf8");
    expect(library.includes('export * from "./account"'), "library.ts must not reference the non-existent ./account").toBe(false);
    expect(fs.existsSync(path.join(projectDir, "webpack.dev.js"))).toBe(true);
  });

  it("restores dependencies (no npm ERESOLVE; paket restores XrmDefinitelyTyped)", () => {
    for (const cmd of restoreCommands()) {
      cp.execSync(cmd, { cwd: projectDir, stdio: "pipe", timeout: 300000 });
    }
    expect(fs.existsSync(path.join(projectDir, "node_modules", "typescript")), "typescript installed").toBe(true);
    expect(
      fs.existsSync(path.join(projectDir, "packages", "Delegate.XrmDefinitelyTyped", "content", "XrmDefinitelyTyped", "XrmDefinitelyTyped.exe")),
      "XrmDefinitelyTyped restored via paket",
    ).toBe(true);
  }, 600000);

  it("generates typings with XrmDefinitelyTyped (produces webresources_src/lib/dg.xrmquery.web.min)", () => {
    const orgUrl = e.url.replace(/\/+$/, "");
    const solution = cfg.solutionUniqueName;
    const exe = path.join(projectDir, "packages", "Delegate.XrmDefinitelyTyped", "content", "XrmDefinitelyTyped", "XrmDefinitelyTyped.exe");
    const args = [
      `/url:${orgUrl}/XRMServices/2011/Organization.svc`,
      "/out:typings\\XRM",
      `/ss:${solution}`,
      `/mfaAppId:${e.clientId}`,
      `/mfaReturnUrl:${orgUrl}`,
      `/mfaClientSecret:${e.clientSecret}`,
      "/jsLib:webresources_src\\lib",
      "/method:ClientSecret",
      `/w:${solution}Web`,
      `/r:${solution}Rest`,
    ];
    cp.execFileSync(exe, args, { cwd: projectDir, stdio: "pipe", timeout: 300000 });
    // XDT emits the XrmQuery JS lib that webpack.common.js require.resolve()s at build time.
    expect(fs.existsSync(path.join(projectDir, "webresources_src", "lib", "dg.xrmquery.web.min.js")), "dg.xrmquery.web.min.js emitted by XDT").toBe(true);
  }, 300000);

  it("builds the scaffolded project to bin/<prefix>_library.js", () => {
    try {
      cp.execSync("webpack --config webpack.dev.js", { cwd: projectDir, stdio: "pipe", timeout: 180000 });
    } catch (err: any) {
      const output = `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}`;
      throw new Error(`webpack build failed (project kept at ${projectDir}):\n${output.slice(-2500)}`);
    }
    expect(fs.existsSync(path.join(projectDir, "bin", libraryName)), `bin/${libraryName} produced by webpack`).toBe(true);
  }, 180000);

  it("deploys the built webresource through the extension code and verifies it in Dataverse", async () => {
    const content = fs.readFileSync(path.join(projectDir, "bin", libraryName)).toString("base64");
    const webresource = new DataverseWebresource(libraryName, context);
    await webresource.upsert(content, 3, "dvpt scaffold lifecycle test");
    await webresource.addToSolution(cfg.solutionUniqueName);
    const found = await client.findWebresourceByName(libraryName);
    expect(found?.webresourceid, `${libraryName} not found in Dataverse after deploy`).toBeTruthy();
  }, 120000);
});
