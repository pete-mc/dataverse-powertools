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
