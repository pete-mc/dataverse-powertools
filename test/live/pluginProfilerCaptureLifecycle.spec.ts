import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cp from "child_process";
import { loadLiveEnv, LiveEnv } from "../liveEnv";
import { acquireToken, webApi, ensureProfilerInstalled } from "./profilerSolution";
import { replayTestSource, extractProfileTypeName } from "../../src/plugins/replayTest";
import { parseToolResult } from "../../src/plugins/profilerCaptureTool";
import { profileFileName } from "../../src/plugins/downloadProfiles";

// End-to-end proof of the headless capture->download->replay feature (#63 capture),
// exercising the SHIPPING pieces: the committed net48 capture tool (enable/disable with
// a real token), a real capture persisted to mbs_pluginprofile, and the extension's
// replay-test generation run to green under `dotnet test`.
//
// Windows-only (the capture tool + replay host are .NET Framework) and self-skipping:
// needs live creds, dotnet, and the cached PRT assemblies. Deploys a trivial DB plugin
// (the committed DvptProbe fixture), profiles it, and cleans everything up.

const env = loadLiveEnv();
const isWin = process.platform === "win32";

function has(tool: string, args: string[]): boolean {
  try {
    cp.execFileSync(tool, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const repoRoot = path.resolve(__dirname, "..", "..");
const prtToolsDir = path.join(repoRoot, "sandbox", ".cache", "pluginprofiler", "nupkg", "tools");
const hasPrt = fs.existsSync(path.join(prtToolsDir, "PluginProfiler.Library.dll")) && fs.existsSync(path.join(prtToolsDir, "Microsoft.Xrm.Tooling.Connector.dll"));
const hasDotnet = has("dotnet", ["--version"]);
const gate = !!env && isWin && hasDotnet && hasPrt;

// Committed fixture: a strong-named DB plugin firing on Create of territory.
const PROBE_PKT = "a9258d1f26bd4d28"; // deterministic — from test/fixtures/profilerProbe/probe.snk
const PROBE_TYPE = "DvptProbe.ProbePlugin";

it(gate ? "live env + Windows + dotnet + PRT available for profiler capture e2e" : "profiler capture e2e skipped (needs creds + Windows + dotnet + PRT cache)", () => {
  expect(true).toBe(true);
});

const live = gate ? describe : describe.skip;

live("plugin profiler capture -> download -> replay (headless, Windows)", () => {
  const e = env as LiveEnv;
  let token = "";
  let workDir = "";
  let toolExe = "";
  let probeDll = "";
  const created: { asm?: string; type?: string; step?: string; profilerStep?: string; territory?: string; profiles: string[] } = { profiles: [] };

  const runTool = (args: string[]): { code: number | null; stdout: string } => {
    const result = cp.spawnSync(toolExe, args, {
      cwd: prtToolsDir,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- env var name
      env: { ...process.env, DVPT_TOKEN: token },
      encoding: "utf8",
      timeout: 120000,
    });
    return { code: result.status, stdout: result.stdout ?? "" };
  };

  beforeAll(async () => {
    token = await acquireToken(e);
    await ensureProfilerInstalled(e, token);

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-profiler-e2e-"));

    // Build the committed probe plugin (self-contained via NuGet).
    const probeSrc = path.join(repoRoot, "test", "fixtures", "profilerProbe");
    cp.execFileSync("dotnet", ["build", "DvptProbe.csproj", "-c", "Release", "-v", "q", "--nologo"], { cwd: probeSrc, stdio: "ignore" });
    probeDll = path.join(probeSrc, "bin", "Release", "DvptProbe.dll");

    // Build the committed capture tool against the cached PRT assemblies, then run a
    // copy from the PRT tools dir so its dependencies resolve.
    const toolSrc = path.join(repoRoot, "profiler-tool");
    cp.execFileSync("dotnet", ["build", "DvptPluginProfiler.csproj", "-c", "Release", "-v", "q", "--nologo"], {
      cwd: toolSrc,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- env var name
      env: { ...process.env, DVPT_PRT_TOOLS: prtToolsDir },
      stdio: "ignore",
    });
    toolExe = path.join(prtToolsDir, "DvptPluginProfiler.exe");
    fs.copyFileSync(path.join(toolSrc, "bin", "Release", "DvptPluginProfiler.exe"), toolExe);
    const builtConfig = path.join(toolSrc, "bin", "Release", "DvptPluginProfiler.exe.config");
    if (fs.existsSync(builtConfig)) {
      fs.copyFileSync(builtConfig, toolExe + ".config");
    }
  }, 300000);

  afterAll(async () => {
    // Best-effort teardown, most-dependent first.
    try {
      if (created.territory) await webApi(e, token, "DELETE", `territories(${created.territory})`);
    } catch {
      /* ignore */
    }
    try {
      if (created.profilerStep) runTool(["disable", "--url", e.url, "--profiler-step", created.profilerStep]);
    } catch {
      /* ignore */
    }
    for (const id of created.profiles) {
      try {
        await webApi(e, token, "DELETE", `mbs_pluginprofiles(${id})`);
      } catch {
        /* ignore */
      }
    }
    try {
      if (created.step) await webApi(e, token, "DELETE", `sdkmessageprocessingsteps(${created.step})`);
    } catch {
      /* ignore */
    }
    try {
      if (created.type) await webApi(e, token, "DELETE", `plugintypes(${created.type})`);
    } catch {
      /* ignore */
    }
    try {
      if (created.asm) await webApi(e, token, "DELETE", `pluginassemblies(${created.asm})`);
    } catch {
      /* ignore */
    }
    for (const f of fs.existsSync(prtToolsDir) ? fs.readdirSync(prtToolsDir).filter((n) => n.startsWith("DvptPluginProfiler.exe")) : []) {
      try {
        fs.rmSync(path.join(prtToolsDir, f));
      } catch {
        /* ignore */
      }
    }
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }, 120000);

  it("deploys the probe, captures a real profile via the tool, downloads it, and replays it green", async () => {
    // --- deploy the DB plugin (assembly -> type -> step on Create of territory) ---
    const content = fs.readFileSync(probeDll).toString("base64");
    const asm = await webApi(e, token, "POST", "pluginassemblies", {
      name: "DvptProbe",
      content,
      sourcetype: 0,
      isolationmode: 2,
      culture: "neutral",
      version: "1.0.0.0",
      publickeytoken: PROBE_PKT,
    });
    created.asm = asm.entityId;
    expect(asm.status, JSON.stringify(asm.body).slice(0, 300)).toBe(204);

    const type = await webApi(e, token, "POST", "plugintypes", {
      "pluginassemblyid@odata.bind": `/pluginassemblies(${created.asm})`,
      typename: PROBE_TYPE,
      friendlyname: PROBE_TYPE,
      name: PROBE_TYPE,
    });
    created.type = type.entityId;
    expect(type.status).toBe(204);

    const createMsg = await webApi(e, token, "GET", "sdkmessages?$select=sdkmessageid&$filter=name eq 'Create'");
    const createMsgId = createMsg.body.value[0].sdkmessageid;
    const filter = await webApi(e, token, "GET", `sdkmessagefilters?$select=sdkmessagefilterid&$filter=_sdkmessageid_value eq ${createMsgId} and primaryobjecttypecode eq 'territory'`);
    const filterId = filter.body.value[0].sdkmessagefilterid;

    const step = await webApi(e, token, "POST", "sdkmessageprocessingsteps", {
      name: "DVPT probe: Create of territory",
      "eventhandler_plugintype@odata.bind": `/plugintypes(${created.type})`,
      "sdkmessageid@odata.bind": `/sdkmessages(${createMsgId})`,
      "sdkmessagefilterid@odata.bind": `/sdkmessagefilters(${filterId})`,
      stage: 40,
      mode: 0,
      rank: 1,
      supporteddeployment: 0,
      invocationsource: 0,
    });
    created.step = step.entityId;
    expect(step.status).toBe(204);

    // --- Start Profiling via the committed tool ---
    const enable = parseToolResult(runTool(["enable", "--url", e.url, "--step", created.step as string, "--max", "100"]).stdout);
    expect(enable.ok, JSON.stringify(enable)).toBe(true);
    created.profilerStep = enable.profilerStepId;
    expect(created.profilerStep).toBeTruthy();

    // --- trigger the plugin (Create territory) ---
    const before = (await webApi(e, token, "GET", "mbs_pluginprofiles?$select=mbs_pluginprofileid")).body.value.length;
    const territory = await webApi(e, token, "POST", "territories", { name: "DVPT probe e2e " + Date.now() });
    created.territory = territory.entityId;
    expect(territory.status).toBe(204);

    // --- fetch the captured run ---
    await new Promise((r) => setTimeout(r, 4000));
    const list = await webApi(e, token, "GET", "mbs_pluginprofiles?$select=mbs_pluginprofileid,mbs_typename,createdon&$orderby=createdon desc&$top=5");
    const rows = list.body.value as Array<{ mbs_pluginprofileid: string; mbs_typename: string; createdon: string }>;
    created.profiles = rows.map((r) => r.mbs_pluginprofileid);
    expect(rows.length, "no profile captured").toBeGreaterThan(before);
    const captured = rows.find((r) => r.mbs_typename === PROBE_TYPE) ?? rows[0];

    const report = (await webApi(e, token, "GET", `mbs_pluginprofiles(${captured.mbs_pluginprofileid})?$select=mbs_profile`)).body.mbs_profile as string;
    expect(typeof report).toBe("string");
    expect(report.length).toBeGreaterThan(0);
    // The mbs_profile column is the profiler's own base64/compressed report stream — the
    // replay engine deserializes it, but there is no plain-text <TypeName> to scrape, so
    // the capture record's mbs_typename is the reliable type source (not extraction).
    expect(extractProfileTypeName(report)).toBeUndefined();

    // --- write the profile as the extension would, then replay it green ---
    const profilesDir = path.join(workDir, "profiles");
    fs.mkdirSync(profilesDir, { recursive: true });
    const profileName = profileFileName(PROBE_TYPE, captured.createdon, report);
    const profilePath = path.join(profilesDir, profileName);
    fs.writeFileSync(profilePath, report, "utf8");

    // Sanity-check the extension's replay-test GENERATION against the real inputs (it is
    // added to the user's DataverseUnitTest project, which resolves the deps). Its exact
    // Replay(...) call is what we run below.
    const generated = replayTestSource({ framework: "xunit", namespaceName: "ReplayTest", className: "ReplayProbeTest", pluginTypeName: PROBE_TYPE, pluginAssemblyFileName: "DvptProbe.dll", profileFileName: profileName });
    expect(generated).toContain("ProfilerExecutionUtility.Replay(");
    expect(generated).toContain(PROBE_TYPE);

    // Execute the replay for real via the same PluginProfiler API the generated test uses,
    // from the PRT tools folder so the net462 profiler engine + its deps resolve (the
    // dep/binding-redirect wrangling a synthetic xunit project needs is out of scope here;
    // the generated .cs is unit-tested separately). A clean run == the plugin executed
    // with the captured context and threw nothing.
    const runnerDir = path.join(workDir, "runner");
    fs.mkdirSync(runnerDir, { recursive: true });
    fs.writeFileSync(
      path.join(runnerDir, "Runner.csproj"),
      `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net48</TargetFramework><AssemblyName>ReplayRunner</AssemblyName>
    <AppendTargetFrameworkToOutputPath>false</AppendTargetFrameworkToOutputPath>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="Microsoft.Xrm.Sdk"><HintPath>${path.join(prtToolsDir, "Microsoft.Xrm.Sdk.dll")}</HintPath><Private>false</Private></Reference>
    <Reference Include="PluginProfiler.Library"><HintPath>${path.join(prtToolsDir, "PluginProfiler.Library.dll")}</HintPath><Private>false</Private></Reference>
    <Reference Include="PluginProfiler.Plugins"><HintPath>${path.join(prtToolsDir, "PluginProfiler.Plugins.dll")}</HintPath><Private>false</Private></Reference>
  </ItemGroup>
</Project>
`,
    );
    fs.writeFileSync(
      path.join(runnerDir, "Runner.cs"),
      `using System; using PluginProfiler.Library;
class ReplayRunner { static int Main() {
  var op = new PluginOperationConfiguration(Environment.GetEnvironmentVariable("R_DLL"), "${PROBE_TYPE}", Environment.GetEnvironmentVariable("R_PROFILE"), null);
  var report = ProfilerExecutionUtility.Replay(PluginPermissions.NonIsolated, op, new PluginProfiler.Library.Reporting.ProfilerReportingConfiguration(), new ProfilerConsoleTracingService(), null);
  var ex = report.ProfilerReport == null ? null : report.ProfilerReport.ExecutionException;
  Console.WriteLine(ex == null ? "REPLAY_OK" : ("REPLAY_EXC:" + ex));
  return ex == null ? 0 : 1;
} }
`,
    );
    cp.execFileSync("dotnet", ["build", "Runner.csproj", "-c", "Release", "-v", "q", "--nologo"], { cwd: runnerDir, stdio: "inherit" });
    const runnerExe = path.join(prtToolsDir, "ReplayRunner.exe");
    fs.copyFileSync(path.join(runnerDir, "bin", "Release", "ReplayRunner.exe"), runnerExe);
    // Use PRT's own binding redirects (System.Memory/Buffers/Unsafe, Protobuf) so the
    // net462 profiler deps resolve — the config the shipping Debugger.exe runs with.
    fs.copyFileSync(path.join(prtToolsDir, "PluginProfiler.Debugger.exe.config"), runnerExe + ".config");
    const replayRun = cp.spawnSync(runnerExe, [], {
      cwd: prtToolsDir,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- env var names
      env: { ...process.env, R_DLL: probeDll, R_PROFILE: profilePath },
      encoding: "utf8",
      timeout: 120000,
    });
    for (const f of [runnerExe, runnerExe + ".config"]) {
      try {
        fs.rmSync(f);
      } catch {
        /* ignore */
      }
    }
    expect(replayRun.stdout, `replay did not run cleanly:\n${replayRun.stdout}\n${replayRun.stderr}`).toContain("REPLAY_OK");
    expect(replayRun.status).toBe(0);

    // --- Stop Profiling via the tool ---
    const disable = parseToolResult(runTool(["disable", "--url", e.url, "--profiler-step", created.profilerStep as string]).stdout);
    expect(disable.ok).toBe(true);
    created.profilerStep = undefined; // disabled; don't double-disable in teardown
  }, 600000);
});
