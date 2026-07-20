import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";

// Fetch the Plugin Registration Tool NuGet on demand (#63 phase 2c) and place
// the profiler's replay assemblies next to the project. PINNED version — the
// profile report is a DataContract of PluginProfiler types, so the deserialize
// path must not drift underneath us.

export const PRT_NUGET_VERSION = "9.1.0.200";
const PRT_NUPKG_URL = `https://www.nuget.org/api/v2/package/Microsoft.CrmSdk.XrmTooling.PluginRegistrationTool/${PRT_NUGET_VERSION}`;

/** The Plugin Profiler managed solution, shipped inside the PRT NuGet as a .cab
 * (which is actually a solution ZIP that ImportSolution accepts). Base64 for the
 * Web API import. Cached with the nupkg. Undefined on failure. */
export async function getProfilerSolutionBase64(context: DataversePowerToolsContext): Promise<string | undefined> {
  const cacheDir = path.join(context.vscode.globalStorageUri.fsPath, "pluginprofiler", PRT_NUGET_VERSION);
  const cab = path.join(cacheDir, "PluginProfiler.Solution.cab");
  try {
    if (!fs.existsSync(cab)) {
      context.channel.appendLine(`[Profiler] Fetching the Plugin Profiler solution (Plugin Registration Tool ${PRT_NUGET_VERSION})…`);
      const response = await fetch(PRT_NUPKG_URL);
      if (!response.ok) {
        throw new Error(`nupkg download failed: ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      // eslint-disable-next-line @typescript-eslint/naming-convention -- constructor import
      const AdmZip = require("adm-zip");
      const entry = new AdmZip(buffer).getEntry("tools/PluginProfiler.Solution.cab");
      if (!entry) {
        throw new Error("PluginProfiler.Solution.cab not found in the PRT package");
      }
      await fs.promises.mkdir(cacheDir, { recursive: true });
      await fs.promises.writeFile(cab, entry.getData());
    }
    return (await fs.promises.readFile(cab)).toString("base64");
  } catch (error: any) {
    context.channel.appendLine(`[Profiler] Could not fetch the Plugin Profiler solution: ${error?.message ?? error}`);
    return undefined;
  }
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
