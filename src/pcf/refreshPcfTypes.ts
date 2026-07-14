import DataversePowerToolsContext from "../context";
import { runPcfNpmScript } from "./runNpmScript";

// Regenerate the control's manifest typings: `npm run refreshTypes` (pcf-scripts)
// in the component root. PCF has its OWN manifest typings, unrelated to the XDT
// web-resource typings path. Mirrors buildPcf.
export async function refreshPcfTypes(context: DataversePowerToolsContext): Promise<void> {
  await runPcfNpmScript(context, "refreshTypes", "Refreshing PCF types...", "PCF types refreshed successfully.", "Error refreshing PCF types. See output for details.");
}
