import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";

// How-to for the whole profile → debug journey. Since #264 every step of it happens in
// VS Code — "Profile next run" installs the profiler solution if needed and starts/stops
// profiling over the Web API on any OS — so this guide describes the extension's own flow,
// with the Plugin Registration Tool only as the manual alternative. The part that has always
// been ours is the payoff: replaying a captured profile as a unit test you debug with F5
// instead of attaching Visual Studio to PluginRegistration.exe.

export const PROFILING_WIKI = "https://github.com/pete-mc/dataverse-powertools/wiki/Debugging-Plugins";

export async function guidePluginProfiling(context: DataversePowerToolsContext): Promise<void> {
  context.channel.appendLine("[Profiler] To capture and debug a plug-in run:");
  context.channel.appendLine("  1. Build & deploy the plug-in, and register the step you want to profile.");
  context.channel.appendLine("  2. 'Profile next run' (plugin card → Debugging, or the Profile CodeLens on the registration attribute).");
  context.channel.appendLine("  3. Trigger the plug-in (do the action that fires it), then click Continue to fetch the captured run.");
  context.channel.appendLine("  4. 'Replay & debug' to run it under the debugger, stopping on your breakpoints.");
  context.channel.appendLine("[Profiler] Already captured a run in the Plugin Registration Tool? 'Download a run' fetches it,");
  context.channel.appendLine("     or drop the profile file into profiles/ and replay that.");
  const choice = await vscode.window.showInformationMessage(
    "Profile next run starts profiling, waits for you to trigger the plug-in, then fetches the captured run — then Replay & debug it with your breakpoints. Already captured one in the Plugin Registration Tool? Download it instead.",
    "Open guide",
    "Download profiles",
  );
  if (choice === "Open guide") {
    await vscode.env.openExternal(vscode.Uri.parse(PROFILING_WIKI));
  } else if (choice === "Download profiles") {
    await vscode.commands.executeCommand("dataverse-powertools.downloadPluginProfiles");
  }
}
