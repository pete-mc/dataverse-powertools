import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";

// Capturing a plug-in profile is done in the Plugin Registration Tool (its
// "Install Profiler" registers the profiler assembly into the pipeline in a way
// the Web API can't reproduce). Dataverse PowerTools owns the part that's
// genuinely better: turning a captured profile into a unit test you debug in
// VS Code (F5) instead of attaching Visual Studio to PluginRegistration.exe.
// This command guides the user through the capture step.

export const PROFILING_WIKI = "https://github.com/pete-mc/dataverse-powertools/wiki/Debugging-Plugins";

export async function guidePluginProfiling(context: DataversePowerToolsContext): Promise<void> {
  context.channel.appendLine("[Profiler] To capture a plug-in profile:");
  context.channel.appendLine("  1. In the Plugin Registration Tool, Install Profiler (once per environment).");
  context.channel.appendLine("  2. Select your step → Start Profiling → choose 'Persist to Entity'.");
  context.channel.appendLine("  3. Trigger the plug-in (do the action that fires it).");
  context.channel.appendLine("  4. Back here: run 'Download Captured Plugin Profiles' (or drop the profile file into profiles/),");
  context.channel.appendLine("     then 'Replay Plugin Profile as Unit Test' to debug it in VS Code.");
  const choice = await vscode.window.showInformationMessage(
    "Capturing a profile is done in the Plugin Registration Tool (Start Profiling → Persist to Entity, then trigger the plug-in). Then Download + Replay it here to debug in VS Code.",
    "Open guide",
    "Download profiles",
  );
  if (choice === "Open guide") {
    await vscode.env.openExternal(vscode.Uri.parse(PROFILING_WIKI));
  } else if (choice === "Download profiles") {
    await vscode.commands.executeCommand("dataverse-powertools.downloadPluginProfiles");
  }
}
