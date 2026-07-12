# DvptPluginProfiler (capture tool)

A small **net48, Windows-only** console tool that lets Dataverse PowerTools drive the
Dataverse **Plugin Profiler** headlessly — starting/stopping profiling on a registered
plug-in step without the Plug-in Registration Tool GUI. This is what powers
**Start Profiling → trigger → auto-fetch the captured run → replay-debug** on Windows.

macOS/Linux users don't build or run this tool; they use the cross-platform path
(download a previously captured profile, or drop in a profile file, then replay).

## Why it exists

Capturing a plug-in profile requires the profiler to be **pipeline-executable**, which
only happens through the profiler's own API — `ProfilerManagementUtility.EnablePlugin`
(the same call PRT's *Start Profiling* button makes). Raw Web-API step manipulation does
not make the profiler fire. That API takes a legacy `CrmServiceClient`, which is
.NET-Framework only — hence net48 / Windows-only, the same constraint as replay.

## Auth

Authenticates with the extension's **own access token** via the `DVPT_TOKEN` environment
variable (wrapped in an `OrganizationWebProxyClient` → `CrmServiceClient`), so it works
under **both** service-principal and interactive auth. No client secret, no login window.

## Commands

```
DvptPluginProfiler.exe enable  --url <orgUrl> --step <stepGuid> [--max <n>]
DvptPluginProfiler.exe disable --url <orgUrl> --profiler-step <profilerStepGuid>
```

Each prints a single JSON line on stdout, e.g. `{"profilerStepId":"…","ok":true}` or
`{"ok":false,"error":"…"}`; human-readable progress goes to stderr.

## Build & dependencies

The tool references the profiler + tooling assemblies from the **Plugin Registration
Tool NuGet** at build time only (`Private=false` — not copied to output). At run time the
built `DvptPluginProfiler.exe` is executed from **inside the extension's fetched PRT
assemblies folder**, so the CLR resolves those dependencies from there.

```
# On Windows, with the PRT tools DLLs available:
DVPT_PRT_TOOLS=<path-to-prt-tools> dotnet build profiler-tool -c Release
```

If `DVPT_PRT_TOOLS` is unset the project falls back to
`sandbox/.cache/pluginprofiler/nupkg/tools` (where the extension/tests fetch the PRT
package).

## Shipping

The built `DvptPluginProfiler.exe` (+ `.config`) is committed under `tools/pluginprofiler/`
and packaged into the VSIX directly — it's a tiny (~10 KB) first-party binary and the
Marketplace publish runs on Linux, which can't build .NET Framework. When you change the
tool source, rebuild on Windows and copy the output into `tools/pluginprofiler/`:

```
DVPT_PRT_TOOLS=<prt-tools> dotnet build profiler-tool -c Release
cp profiler-tool/bin/Release/DvptPluginProfiler.exe* tools/pluginprofiler/
```

`scripts/fetchProfilerTool.mjs` and `.github/workflows/build-profiler-tool.yml` remain for
an optional future move to a fetched release artifact (the fetch is a no-op while the exe
is committed — it skips when the file is already present).
