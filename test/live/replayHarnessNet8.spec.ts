import { describe, it, expect, beforeAll } from "vitest";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { replayHarnessSource, replayTestSource, ensureReplayCsproj } from "../../src/plugins/replayTest";
import { ensureMultiTargetedPluginCsproj, DEPLOY_TARGET_FRAMEWORK, MODERN_TARGET_FRAMEWORK } from "../../src/plugins/multiTarget";

// The regression guard for #269: running a captured plug-in profile no longer needs .NET Framework,
// so it no longer needs Windows (or mono).
//
// This drives the SHIPPING generators — replayHarnessSource(), replayTestSource(),
// ensureReplayCsproj() and ensureMultiTargetedPluginCsproj() — through a real
// `dotnet build` + `dotnet test`, and asserts the plug-in actually executed with the decoded
// context. Before #269 the same flow aborted off Windows with "Could not find 'mono' host", because
// the scaffolded test project targeted net4x.
//
// NO credentials and NO org: the profile is synthesised in the profiler's own wire format
// (base64( raw-DEFLATE( <Report><Context>DataContract XML</Context></Report> ) )), so this runs
// anywhere `dotnet` does. Replay against a profile captured from a REAL org is covered by
// pluginProfilerCaptureLifecycle.spec.ts, which needs both.
//
// It lives under test/live rather than in the unit suite because it shells out to the .NET SDK and
// restores NuGet packages — far too slow for a suite that has to stay under a second.

const PLUGIN_TYPE = "DvptReplayProbe.ProbePlugin";
const PROFILE_FILE = "synthetic.profile.xml";

function hasDotnet(): boolean {
  try {
    cp.execFileSync("dotnet", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const gate = hasDotnet();

/**
 * A plug-in whose Execute() PROVES it ran with the captured context: it throws unless the context
 * carries the message name the profile was built with. A test that merely constructs the plug-in
 * would pass even if the context decoded to nulls.
 */
const PLUGIN_SOURCE = `using System;
using Microsoft.Xrm.Sdk;

namespace DvptReplayProbe
{
    public class ProbePlugin : IPlugin
    {
        public ProbePlugin(string unsecure, string secure) { }

        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            trace.Trace("replayed message=" + context.MessageName + " entity=" + context.PrimaryEntityName);
            if (context.MessageName != "Update") throw new InvalidOperationException("context did not decode: MessageName=" + context.MessageName);
            if (context.PrimaryEntityName != "account") throw new InvalidOperationException("context did not decode: PrimaryEntityName=" + context.PrimaryEntityName);
            if (context.Depth != 1) throw new InvalidOperationException("context did not decode: Depth=" + context.Depth);
        }
    }
}
`;

/**
 * Writes the profile fixture, in the profiler's wire format, from inside the test assembly — it
 * reuses the harness's own CapturedPluginContext contract, so the bytes are symmetric with what
 * LoadContext expects. A [ModuleInitializer] so it lands before any test runs, which keeps the
 * GENERATED replay test file byte-for-byte what the product writes.
 */
const FIXTURE_SOURCE = `using System;
using System.IO;
using System.IO.Compression;
using System.Runtime.CompilerServices;
using System.Runtime.Serialization;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using DvptReplay;
using Microsoft.Xrm.Sdk;

internal static class ProfileFixture
{
    [ModuleInitializer]
    internal static void Write()
    {
        var context = new CapturedPluginContext
        {
            MessageName = "Update",
            PrimaryEntityName = "account",
            Depth = 1,
            UserId = Guid.NewGuid(),
            CorrelationId = Guid.NewGuid(),
            InputParameters = new ParameterCollection(),
            OutputParameters = new ParameterCollection(),
            SharedVariables = new ParameterCollection(),
            PreEntityImages = new EntityImageCollection(),
            PostEntityImages = new EntityImageCollection(),
        };
        var serializer = new DataContractSerializer(typeof(object), new[] { typeof(CapturedPluginContext) });
        var contextXml = new StringBuilder();
        using (var writer = XmlWriter.Create(contextXml, new XmlWriterSettings { OmitXmlDeclaration = true }))
        {
            serializer.WriteObject(writer, context);
        }
        var report = new XDocument(new XElement("Report", new XElement("Context", contextXml.ToString()))).ToString();
        byte[] compressed;
        using (var output = new MemoryStream())
        {
            using (var deflate = new DeflateStream(output, CompressionMode.Compress, true))
            {
                var raw = Encoding.UTF8.GetBytes(report);
                deflate.Write(raw, 0, raw.Length);
            }
            compressed = output.ToArray();
        }
        var directory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "profiles");
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "${PROFILE_FILE}"), Convert.ToBase64String(compressed));
    }
}
`;

describe.skipIf(!gate)("replaying a captured profile without .NET Framework (#269)", () => {
  let workDir = "";
  let pluginDir = "";
  let testDir = "";

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-replay-net8-"));
    pluginDir = path.join(workDir, "DvptReplayProbe");
    testDir = path.join(workDir, "DvptReplayProbe.Tests");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(testDir, { recursive: true });
  }, 60000);

  it("multi-targets the plug-in project so it builds for BOTH the deploy and the test framework", () => {
    // Exactly the shape `pac plugin init` leaves behind, put through the shipping transform.
    const pacGenerated = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>${DEPLOY_TARGET_FRAMEWORK}</TargetFramework>
    <AssemblyName>DvptReplayProbe</AssemblyName>
    <LangVersion>latest</LangVersion>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="Probe.cs" />
    <PackageReference Include="Microsoft.CrmSdk.CoreAssemblies" Version="9.0.2.51" />
  </ItemGroup>
</Project>
`;
    fs.writeFileSync(path.join(pluginDir, "DvptReplayProbe.csproj"), ensureMultiTargetedPluginCsproj(pacGenerated));
    fs.writeFileSync(path.join(pluginDir, "Probe.cs"), PLUGIN_SOURCE);

    cp.execFileSync("dotnet", ["build", "DvptReplayProbe.csproj", "-c", "Debug", "-v", "q", "--nologo"], { cwd: pluginDir, stdio: "inherit" });

    // Both frameworks present: net462 is what gets deployed, net8.0 is what the tests run against.
    expect(fs.existsSync(path.join(pluginDir, "bin", "Debug", DEPLOY_TARGET_FRAMEWORK, "DvptReplayProbe.dll")), "net462 output").toBe(true);
    expect(fs.existsSync(path.join(pluginDir, "bin", "Debug", MODERN_TARGET_FRAMEWORK, "DvptReplayProbe.dll")), "net8.0 output").toBe(true);
  }, 600000);

  it("packs a deploy build that still contains ONLY the framework Dataverse loads", () => {
    // The whole point of the DvptDeployBuild property: multi-targeting must not change the shipped
    // package. Pack derives its dependency groups from the RESTORE graph, so this has to be passed
    // to the build as well as the pack, or a stray net8.0 group appears in the nuspec.
    const outDir = path.join(workDir, "pack-out");
    cp.execFileSync("dotnet", ["build", "DvptReplayProbe.csproj", "-c", "Debug", "-v", "q", "--nologo", "-p:DvptDeployBuild=true"], { cwd: pluginDir, stdio: "inherit" });
    cp.execFileSync("dotnet", ["pack", "DvptReplayProbe.csproj", "-c", "Debug", "--no-build", "-v", "q", "--nologo", "-p:DvptDeployBuild=true", "-p:PackageId=dvpt_replayprobe", "-p:Version=1.0.0", "-o", outDir], {
      cwd: pluginDir,
      stdio: "inherit",
    });

    const nupkg = fs.readdirSync(outDir).find((name) => name.endsWith(".nupkg"));
    expect(nupkg, "a package was produced").toBeTruthy();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AdmZip = require("adm-zip");
    const entries: string[] = new AdmZip(path.join(outDir, nupkg!)).getEntries().map((entry: any) => entry.entryName);
    const libs = entries.filter((name) => name.startsWith("lib/"));
    expect(libs).toEqual([`lib/${DEPLOY_TARGET_FRAMEWORK}/DvptReplayProbe.dll`]);

    const nuspec = entries.find((name) => name.endsWith(".nuspec"))!;
    const nuspecText = new AdmZip(path.join(outDir, nupkg!)).readAsText(nuspec);
    expect(nuspecText, "no stray modern dependency group in the shipped package").not.toContain(MODERN_TARGET_FRAMEWORK);
  }, 600000);

  it("runs the generated replay test green under dotnet test — no mono, no .NET Framework host", () => {
    cp.execFileSync("dotnet", ["new", "xunit", "--name", "DvptReplayProbe.Tests", "--output", testDir, "--force"], { cwd: workDir, stdio: "inherit" });

    // DataverseUnitTest is what `Setup Plugin Unit Testing` adds, and it pulls
    // Microsoft.PowerPlatform.Dataverse.Client in transitively with a floor that rises over time
    // (3.4.0.54 wants >= 1.2.10). Without it in this project the replay reference could be pinned
    // BELOW that floor and nothing here would notice — which is exactly what happened: a hard 1.2.5
    // pin shipped, and the e2e caught NU1605 "Detected package downgrade" (an error, not a warning)
    // only once a real profiler run reached `dotnet test`. Keep this reference.
    cp.execFileSync("dotnet", ["add", path.join(testDir, "DvptReplayProbe.Tests.csproj"), "package", "DataverseUnitTest"], { cwd: workDir, stdio: "inherit" });

    const csprojPath = path.join(testDir, "DvptReplayProbe.Tests.csproj");
    let csproj = fs.readFileSync(csprojPath, "utf8");
    csproj = csproj.replace(/<TargetFramework>[^<]+<\/TargetFramework>/i, `<TargetFramework>${MODERN_TARGET_FRAMEWORK}</TargetFramework>`);
    // The shipping transform: on a modern project it must supply Microsoft.Xrm.Sdk from the
    // netstandard client package, NOT the Framework-only CoreAssemblies (which would fail restore).
    csproj = ensureReplayCsproj(csproj);
    csproj = csproj.replace(/<\/Project>\s*$/, `  <ItemGroup>\n    <ProjectReference Include="..${path.sep}DvptReplayProbe${path.sep}DvptReplayProbe.csproj" />\n  </ItemGroup>\n</Project>\n`);
    fs.writeFileSync(csprojPath, csproj);
    expect(csproj, "no Framework-only SDK package on a modern test project").not.toContain("Microsoft.CrmSdk.CoreAssemblies");

    fs.rmSync(path.join(testDir, "UnitTest1.cs"), { force: true });
    fs.writeFileSync(path.join(testDir, "DvptProfileReplay.cs"), replayHarnessSource());
    fs.writeFileSync(path.join(testDir, "ProfileFixture.cs"), FIXTURE_SOURCE);
    fs.writeFileSync(
      path.join(testDir, "Replay_ProbePlugin.cs"),
      replayTestSource({
        framework: "xunit",
        namespaceName: "DvptReplayProbe.Tests",
        className: "Replay_ProbePlugin_synthetic",
        pluginTypeName: PLUGIN_TYPE,
        profileFileName: PROFILE_FILE,
      }),
    );

    const run = cp.spawnSync("dotnet", ["test", "DvptReplayProbe.Tests.csproj", "--nologo", "-v", "minimal"], { cwd: testDir, encoding: "utf8", timeout: 900000 });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    // The pre-#269 failure mode, named explicitly so a regression is unmistakable.
    expect(output, "the test project must not need a .NET Framework test host").not.toContain("Could not find 'mono' host");
    // And the regression that shipped WITH #269: a replay SDK reference pinned below the floor
    // DataverseUnitTest requires makes restore fail outright.
    expect(output, "the replay SDK reference must not downgrade DataverseUnitTest's transitive one").not.toContain("NU1605");
    expect(run.status, `replay test did not pass:\n${output}`).toBe(0);
    expect(output).toMatch(/Passed!\s+-\s+Failed:\s+0,\s+Passed:\s+1/);
  }, 900000);
});
