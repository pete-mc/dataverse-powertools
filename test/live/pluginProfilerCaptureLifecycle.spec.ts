import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cp from "child_process";
import { loadLiveEnv, LiveEnv } from "../liveEnv";
import { acquireToken, webApi, ensureProfilerInstalled } from "./profilerSolution";
import { replayTestSource, extractProfileTypeName } from "../../src/plugins/replayTest";
import { enableStepProfiling, disableStepProfiling, profiledOriginalName } from "../../src/general/dataverse/profilerSteps";
import { profileFileName } from "../../src/plugins/downloadProfiles";

// End-to-end proof of the headless capture->download->replay feature (#63 capture),
// exercising the SHIPPING code: the extension's own enable/disable (Web API) against a real
// org, a real capture persisted to mbs_pluginprofile, and the replay of that capture.
//
// CAPTURE runs on any OS since #264 — it used to shell out to a net48, Windows-only console
// tool, and this whole file was Windows-gated because of it. Only the REPLAY test below is
// still Windows-only: it executes the net462 profiler engine directly (the product's own
// replay goes through the user's DataverseUnitTest project).
//
// Self-skipping: needs live creds + dotnet. Deploys a trivial DB plugin (the committed
// DvptProbe fixture), profiles it, and cleans everything up.

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
const hasPrt = fs.existsSync(path.join(prtToolsDir, "PluginProfiler.Library.dll"));
const hasDotnet = has("dotnet", ["--version"]);
const gate = !!env && hasDotnet;
// The replay RUNNER below is net48 + the PRT profiler engine: Windows only.
const replayGate = gate && isWin && hasPrt;

// Committed fixture: a strong-named DB plugin firing on Create of territory.
const PROBE_PKT = "a9258d1f26bd4d28"; // deterministic — from test/fixtures/profilerProbe/probe.snk
const PROBE_TYPE = "DvptProbe.ProbePlugin";
const STEP_NAME = "DVPT probe: Create of territory";

it(gate ? "live env + dotnet available for profiler capture e2e" : "profiler capture e2e skipped (needs creds + dotnet)", () => {
  expect(true).toBe(true);
});

const live = gate ? describe : describe.skip;

live("plugin profiler capture -> download -> replay (headless)", () => {
  const e = env as LiveEnv;
  let token = "";
  let workDir = "";
  let probeDll = "";
  let profilePath = "";
  const created: { asm?: string; type?: string; step?: string; profilerStep?: string; territory?: string; profiles: string[] } = { profiles: [] };

  /** The context shape the extension's profiler code needs — a live connection and a channel.
   * This drives the SHIPPING functions rather than re-implementing their calls in the test. */
  const liveContext = (): any => ({
    dataverse: { organizationUrl: e.url, isValid: true, getAuthorizationToken: async () => token },
    channel: { appendLine: (line: string) => console.log(`[profiler] ${line}`), show: () => undefined },
  });

  beforeAll(async () => {
    token = await acquireToken(e);
    await ensureProfilerInstalled(e, token);
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-profiler-e2e-"));

    // Build the committed probe plugin (self-contained via NuGet). net462 compiles on any OS.
    const probeSrc = path.join(repoRoot, "test", "fixtures", "profilerProbe");
    cp.execFileSync("dotnet", ["build", "DvptProbe.csproj", "-c", "Release", "-v", "q", "--nologo"], { cwd: probeSrc, stdio: "ignore" });
    probeDll = path.join(probeSrc, "bin", "Release", "DvptProbe.dll");
  }, 300000);

  afterAll(async () => {
    // Best-effort teardown, most-dependent first.
    try {
      if (created.territory) await webApi(e, token, "DELETE", `territories(${created.territory})`);
    } catch {
      /* ignore */
    }
    try {
      if (created.profilerStep) await disableStepProfiling(liveContext(), created.profilerStep);
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
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }, 120000);

  it("deploys the probe, captures a real profile via the extension's own enable, and stops cleanly", async () => {
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
      name: STEP_NAME,
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

    // --- Start Profiling through the extension's own code path ---
    const enabled = await enableStepProfiling(liveContext(), created.step as string, 100);
    expect(enabled.ok, JSON.stringify(enabled)).toBe(true);
    created.profilerStep = enabled.profilerStepId;
    expect(created.profilerStep).toBeTruthy();

    // The four things a naive step clone gets wrong (#264): the original must end up renamed
    // AND disabled, or the real plug-in keeps firing and the profiler never sees anything.
    const original = (await webApi(e, token, "GET", `sdkmessageprocessingsteps(${created.step})?$select=name,statecode`)).body;
    expect(original.name).toBe(profiledOriginalName(STEP_NAME));
    expect(original.statecode).toBe(1);

    // --- trigger the plugin (Create territory) ---
    const territory = await webApi(e, token, "POST", "territories", { name: "DVPT probe e2e " + Date.now() });
    created.territory = territory.entityId;
    expect(territory.status).toBe(204);

    // --- fetch the captured run ---
    await new Promise((r) => setTimeout(r, 4000));
    const list = await webApi(e, token, "GET", "mbs_pluginprofiles?$select=mbs_pluginprofileid,mbs_typename,createdon&$orderby=createdon desc&$top=5");
    const rows = list.body.value as Array<{ mbs_pluginprofileid: string; mbs_typename: string; createdon: string }>;
    created.profiles = rows.map((r) => r.mbs_pluginprofileid);
    // Match on FRESHNESS as well as type: this org is shared, and an old row from a previous
    // run would otherwise let a capture that never happened look like a pass.
    const captured = rows.find((r) => r.mbs_typename === PROBE_TYPE && Date.now() - Date.parse(r.createdon) < 180000);
    expect(captured, `no fresh profile captured for ${PROBE_TYPE} (rows: ${JSON.stringify(rows.map((r) => r.mbs_typename))})`).toBeTruthy();

    const report = (await webApi(e, token, "GET", `mbs_pluginprofiles(${captured!.mbs_pluginprofileid})?$select=mbs_profile`)).body.mbs_profile as string;
    expect(typeof report).toBe("string");
    expect(report.length).toBeGreaterThan(0);
    // The mbs_profile column is the profiler's own base64/compressed report stream — the
    // replay engine deserializes it, but there is no plain-text <TypeName> to scrape, so
    // the capture record's mbs_typename is the reliable type source (not extraction).
    expect(extractProfileTypeName(report)).toBeUndefined();

    // --- write the profile as the extension would (input for the replay test below) ---
    const profilesDir = path.join(workDir, "profiles");
    fs.mkdirSync(profilesDir, { recursive: true });
    profilePath = path.join(profilesDir, profileFileName(PROBE_TYPE, captured!.createdon, report));
    fs.writeFileSync(profilePath, report, "utf8");

    // Sanity-check the extension's replay-test GENERATION against the real inputs (it is
    // added to the user's DataverseUnitTest project, which resolves the deps).
    // 0.14.44 (#210) moved generation from PRT's ProfilerExecutionUtility/AppDomain to the
    // IN-PROCESS shape — decode the profile, deserialise the context, invoke the plugin — so
    // assert that shape here, matching src/plugins/replayTest.spec.ts.
    const generated = replayTestSource({ framework: "xunit", namespaceName: "ReplayTest", className: "ReplayProbeTest", pluginTypeName: PROBE_TYPE, profileFileName: path.basename(profilePath) });
    expect(generated).toContain("ProfileReplay.LoadContext(");
    expect(generated).toContain("plugin.Execute(ProfileReplay.CreateServiceProvider(context));");
    expect(generated).not.toContain("ProfilerExecutionUtility");
    expect(generated).toContain(PROBE_TYPE);

    // --- Stop Profiling through the extension's own code path ---
    const disabled = await disableStepProfiling(liveContext(), created.profilerStep as string);
    expect(disabled.ok, JSON.stringify(disabled)).toBe(true);
    created.profilerStep = undefined; // stopped; don't double-stop in teardown

    // Stopping must RESTORE the user's step — name back, enabled again, clone gone. The
    // pre-#264 non-Windows path deleted the clone and left the step disabled, which silently
    // stopped the user's plug-in from running at all.
    const restored = (await webApi(e, token, "GET", `sdkmessageprocessingsteps(${created.step})?$select=name,statecode`)).body;
    expect(restored.name).toBe(STEP_NAME);
    expect(restored.statecode).toBe(0);
  }, 600000);

  (replayGate ? it : it.skip)("replays the captured profile green (Windows: net462 profiler engine)", async () => {
    // Execute the replay for real via the same PluginProfiler API the generated test uses,
    // from the PRT tools folder so the net462 profiler engine + its deps resolve (the
    // dep/binding-redirect wrangling a synthetic xunit project needs is out of scope here;
    // the generated .cs is unit-tested separately). A clean run == the plugin executed
    // with the captured context and threw nothing.
    expect(profilePath, "the capture test must run first").toBeTruthy();
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
  }, 600000);
});
