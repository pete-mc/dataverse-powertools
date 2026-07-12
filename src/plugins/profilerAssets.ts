import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";

// Fetch the Plugin Registration Tool NuGet on demand (#63 phase 2c) and place
// the profiler's replay assemblies next to the project. PINNED version — the
// profile report is a DataContract of PluginProfiler types, so the deserialize
// path must not drift underneath us.

export const PRT_NUGET_VERSION = "9.1.0.200";
const PRT_NUPKG_URL = `https://www.nuget.org/api/v2/package/Microsoft.CrmSdk.XrmTooling.PluginRegistrationTool/${PRT_NUGET_VERSION}`;

/** Folder (under the component root) the replay test references the DLLs from. */
export const PROFILER_LIB_DIR = "profiler-libs";

/** The net462 copies at the nupkg's tools/ root — same TFM as the plugin test host. */
export const PROFILER_ASSEMBLIES = ["PluginProfiler.Library.dll", "PluginProfiler.Plugins.dll"] as const;

/** Download (once, cached in globalStorage) and copy the profiler assemblies into
 * <componentRoot>/profiler-libs. Returns the lib dir, or undefined on failure. */
export async function ensureProfilerAssemblies(context: DataversePowerToolsContext, componentRoot: string): Promise<string | undefined> {
  const libDir = path.join(componentRoot, PROFILER_LIB_DIR);
  if (PROFILER_ASSEMBLIES.every((name) => fs.existsSync(path.join(libDir, name)))) {
    return libDir;
  }

  const cacheDir = path.join(context.vscode.globalStorageUri.fsPath, "pluginprofiler", PRT_NUGET_VERSION);
  const cachedAll = PROFILER_ASSEMBLIES.every((name) => fs.existsSync(path.join(cacheDir, name)));
  if (!cachedAll) {
    try {
      context.channel.appendLine(`[Profiler] Downloading the Plugin Registration Tool package ${PRT_NUGET_VERSION} (one-time, for the replay assemblies)…`);
      const response = await fetch(PRT_NUPKG_URL);
      if (!response.ok) {
        throw new Error(`nupkg download failed: ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());

      // eslint-disable-next-line @typescript-eslint/naming-convention -- constructor import
      const AdmZip = require("adm-zip");
      const zip = new AdmZip(buffer);
      await fs.promises.mkdir(cacheDir, { recursive: true });
      for (const name of PROFILER_ASSEMBLIES) {
        const entry = zip.getEntry(`tools/${name}`);
        if (!entry) {
          throw new Error(`${name} not found in the PRT package`);
        }
        await fs.promises.writeFile(path.join(cacheDir, name), entry.getData());
      }
    } catch (error: any) {
      context.channel.appendLine(`[Profiler] Could not fetch the replay assemblies: ${error?.message ?? error}`);
      context.channel.show();
      vscode.window.showErrorMessage("Could not download the Plugin Profiler replay assemblies — see the output.");
      return undefined;
    }
  }

  await fs.promises.mkdir(libDir, { recursive: true });
  for (const name of PROFILER_ASSEMBLIES) {
    await fs.promises.copyFile(path.join(cacheDir, name), path.join(libDir, name));
  }
  context.channel.appendLine(`[Profiler] Replay assemblies ready in ${libDir}`);
  return libDir;
}

/** Bundled capture tool (Windows-only) that ships in the VSIX. */
export const CAPTURE_TOOL_NAME = "DvptPluginProfiler.exe";

/** Prepare a runtime folder for the capture tool: the FULL Plugin Registration Tool
 * assemblies (the exe needs Microsoft.Xrm.Tooling.Connector et al., not just the two
 * replay DLLs) with a copy of the bundled DvptPluginProfiler.exe alongside — because
 * .NET Framework resolves an exe's dependencies from its own directory. Returns the
 * folder to run the exe from, or undefined on failure. */
export async function ensureCaptureToolRuntime(context: DataversePowerToolsContext): Promise<string | undefined> {
  const bundledExe = path.join(context.vscode.extensionPath, "tools", "pluginprofiler", CAPTURE_TOOL_NAME);
  if (!fs.existsSync(bundledExe)) {
    context.channel.appendLine(`[Profiler] Capture tool not found at ${bundledExe} — reinstall/update the extension.`);
    return undefined;
  }

  const runtimeDir = path.join(context.vscode.globalStorageUri.fsPath, "pluginprofiler-runtime", PRT_NUGET_VERSION);
  const runtimeExe = path.join(runtimeDir, CAPTURE_TOOL_NAME);

  // Extract the full PRT tools/ set once (cached by version).
  if (!fs.existsSync(path.join(runtimeDir, "PluginProfiler.Library.dll")) || !fs.existsSync(path.join(runtimeDir, "Microsoft.Xrm.Tooling.Connector.dll"))) {
    try {
      context.channel.appendLine(`[Profiler] Preparing the capture-tool runtime (Plugin Registration Tool ${PRT_NUGET_VERSION})…`);
      const response = await fetch(PRT_NUPKG_URL);
      if (!response.ok) {
        throw new Error(`nupkg download failed: ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      // eslint-disable-next-line @typescript-eslint/naming-convention -- constructor import
      const AdmZip = require("adm-zip");
      const zip = new AdmZip(buffer);
      await fs.promises.mkdir(runtimeDir, { recursive: true });
      for (const entry of zip.getEntries()) {
        // Flatten the nupkg's tools/ root (dlls, exe.config) next to the exe.
        const match = /^tools\/([^/]+\.(dll|config))$/.exec(entry.entryName);
        if (match) {
          await fs.promises.writeFile(path.join(runtimeDir, match[1]), entry.getData());
        }
      }
    } catch (error: any) {
      context.channel.appendLine(`[Profiler] Could not prepare the capture-tool runtime: ${error?.message ?? error}`);
      context.channel.show();
      return undefined;
    }
  }

  // Copy the bundled exe (+ its .config) in fresh each time so a tool update wins.
  await fs.promises.copyFile(bundledExe, runtimeExe);
  const bundledConfig = bundledExe + ".config";
  if (fs.existsSync(bundledConfig)) {
    await fs.promises.copyFile(bundledConfig, runtimeExe + ".config");
  }
  return runtimeDir;
}
