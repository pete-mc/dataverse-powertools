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
