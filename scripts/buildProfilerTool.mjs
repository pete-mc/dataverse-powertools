// Builds the Windows-only (net48) plugin-profiler capture tool from profiler-tool/
// into tools/pluginprofiler/ so it is packaged into the VSIX — replacing a committed
// binary. Runs at `vscode:prepublish`; the Marketplace publish job runs on a Windows
// runner (see .github/workflows/main.yml) so .NET Framework can be compiled.
//
//   node scripts/buildProfilerTool.mjs        (set DVPT_FORCE_TOOL_BUILD=1 to rebuild)
//
// Behaviour by platform:
//   - Windows: fetch the PRT assemblies, `dotnet build` the tool, copy the exe (+config)
//     into tools/pluginprofiler/. A build failure is FATAL — never publish without it.
//   - macOS/Linux: capture is Windows-only, so this is a no-op (skips with a note). A dev
//     VSIX built there simply won't contain the capture tool; the real publish is on Windows.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cp from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");

// Keep in sync with src/plugins/profilerAssets.ts (PRT_NUGET_VERSION).
const PRT_NUGET_VERSION = "9.1.0.200";
const PRT_NUPKG_URL = `https://www.nuget.org/api/v2/package/Microsoft.CrmSdk.XrmTooling.PluginRegistrationTool/${PRT_NUGET_VERSION}`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "tools", "pluginprofiler");
const exe = path.join(dest, "DvptPluginProfiler.exe");

function log(msg) {
  console.log(`[build-profiler-tool] ${msg}`);
}

if (process.platform !== "win32") {
  log("capture tool is Windows-only (net48) — skipping build on this platform. The VSIX built here will not include it; the Marketplace publish builds it on a Windows runner.");
  process.exit(0);
}

if (fs.existsSync(exe) && !process.env.DVPT_FORCE_TOOL_BUILD) {
  log("tool already built — skipping. Set DVPT_FORCE_TOOL_BUILD=1 to rebuild.");
  process.exit(0);
}

async function main() {
  // 1) Fetch the PRT assemblies the tool builds against (cached under the OS temp dir).
  const prtDir = path.join(os.tmpdir(), `dvpt-prt-${PRT_NUGET_VERSION}`);
  if (!fs.existsSync(path.join(prtDir, "PluginProfiler.Library.dll"))) {
    log(`fetching the Plugin Registration Tool assemblies (${PRT_NUGET_VERSION})…`);
    const res = await fetch(PRT_NUPKG_URL);
    if (!res.ok) {
      throw new Error(`PRT nupkg download failed: ${res.status} ${res.statusText}`);
    }
    const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
    fs.mkdirSync(prtDir, { recursive: true });
    for (const entry of zip.getEntries()) {
      const m = /^tools\/([^/]+\.(dll|config))$/.exec(entry.entryName);
      if (m) {
        fs.writeFileSync(path.join(prtDir, m[1]), entry.getData());
      }
    }
  }

  // 2) Build the tool against those assemblies.
  log("building profiler-tool (net48, Release)…");
  cp.execFileSync("dotnet", ["build", path.join(root, "profiler-tool", "DvptPluginProfiler.csproj"), "-c", "Release", "-v", "q", "--nologo"], {
    stdio: "inherit",
    // eslint-disable-next-line @typescript-eslint/naming-convention -- env var name
    env: { ...process.env, DVPT_PRT_TOOLS: prtDir },
  });

  // 3) Copy the built exe (+ its .config with the binding redirects) into the VSIX folder.
  const builtDir = path.join(root, "profiler-tool", "bin", "Release");
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(builtDir, "DvptPluginProfiler.exe"), exe);
  const cfg = path.join(builtDir, "DvptPluginProfiler.exe.config");
  if (fs.existsSync(cfg)) {
    fs.copyFileSync(cfg, exe + ".config");
  }
  if (!fs.existsSync(exe)) {
    throw new Error("build did not produce DvptPluginProfiler.exe");
  }
  log(`built ${exe}`);
}

main().catch((e) => {
  console.error(`[build-profiler-tool] ${e?.message ?? e}`);
  process.exit(1);
});
