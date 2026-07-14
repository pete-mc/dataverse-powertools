import DataversePowerToolsContext from "../context";
import { runPcfNpmScript } from "./runNpmScript";

// Local build of a PCF control: `npm run build` (pcf-scripts) in the component
// root. Mirrors src/plugins/buildProject.ts.
export async function buildPcf(context: DataversePowerToolsContext): Promise<void> {
  await runPcfNpmScript(context, "build", "Building PCF control...", "PCF build completed successfully.", "Error building PCF control. See output for details.");
}
