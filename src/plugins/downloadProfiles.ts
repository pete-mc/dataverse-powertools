import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import DataversePowerToolsContext from "../context";
import { isProfilerInstalled, getPluginProfiles, getPluginProfileContent, PluginProfileRecord } from "../general/dataverse/pluginProfiles";
import { activeComponentRoot } from "../components/componentDiscovery";

// Download captured plug-in profiles (#63 phase 2a): list the org's persisted
// mbs_pluginprofile rows and save the picked ones into profiles/ in the plugin
// project — the input the replay-as-generated-test flow (phase 2c) consumes.

/** Local file name for a profile: sanitized type name + capture timestamp.
 * Reports are XML (the profiler serializes a DataContract report) — sniff so a
 * future non-XML payload still lands with a sensible extension. Pure. */
export function profileFileName(typeName: string | undefined, createdon: string | undefined, content: string): string {
  const safeType = (typeName || "profile").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
  const date = createdon ? new Date(createdon) : undefined;
  const stamp =
    date && !isNaN(date.getTime())
      ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`
      : "unknown-time";
  const extension = content.trimStart().startsWith("<") ? ".profile.xml" : ".profile";
  return `${safeType}_${stamp}${extension}`;
}

/** Quick-pick label for one captured profile. Pure. */
export function profilePickLabel(profile: PluginProfileRecord): { label: string; description: string } {
  const mode = profile.mbs_mode === 1 ? "async" : "sync";
  return {
    label: profile.mbs_typename || "(unknown plugin type)",
    description: [profile.mbs_messagename, profile.mbs_primaryentity, mode, profile.createdon ? new Date(profile.createdon).toLocaleString() : undefined]
      .filter(Boolean)
      .join(" · "),
  };
}

export async function downloadPluginProfiles(context: DataversePowerToolsContext): Promise<void> {
  const componentRoot = activeComponentRoot(context);
  if (!componentRoot) {
    vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  const installed = await isProfilerInstalled(context);
  if (installed === undefined) {
    vscode.window.showErrorMessage("Could not reach Dataverse to check for the Plugin Profiler — see the output.");
    return;
  }
  if (!installed) {
    // Guided path: the profiler is the PRT's managed solution; installing it is a
    // one-time org action. (Auto-install from the PRT NuGet is a later wave.)
    vscode.window.showWarningMessage(
      "The Plugin Profiler solution isn't installed in this environment. Install it once via the Plugin Registration Tool (Install Profiler), profile a step, then retry.",
    );
    context.channel.appendLine(
      "[Profiler] Solution 'PluginProfiler' not found. Install: Plugin Registration Tool → Install Profiler (adds the managed solution), then Start Profiling on a step in 'Persist to Entity' mode.",
    );
    return;
  }

  const profiles = await getPluginProfiles(context);
  if (!profiles) {
    return; // logged
  }
  if (profiles.length === 0) {
    vscode.window.showInformationMessage("No captured profiles in this environment yet — Start Profiling a step (persist to entity), trigger it, then retry.");
    return;
  }

  const picks = await vscode.window.showQuickPick(
    profiles.map((profile) => ({ ...profilePickLabel(profile), target: profile })),
    { placeHolder: "Download which captured profiles?", canPickMany: true, ignoreFocusOut: true },
  );
  if (!picks || picks.length === 0) {
    return;
  }

  const profilesDir = path.join(componentRoot, "profiles");
  await fs.promises.mkdir(profilesDir, { recursive: true });
  let downloaded = 0;
  for (const pick of picks) {
    const content = await getPluginProfileContent(context, pick.target.mbs_pluginprofileid);
    if (!content) {
      context.channel.appendLine(`[Profiler] Profile ${pick.target.mbs_pluginprofileid} has no report content — skipped.`);
      continue;
    }
    const file = path.join(profilesDir, profileFileName(pick.target.mbs_typename, pick.target.createdon, content));
    await fs.promises.writeFile(file, content, "utf8");
    context.channel.appendLine(`[Profiler] Saved ${file}`);
    downloaded++;
  }
  if (downloaded > 0) {
    vscode.window.showInformationMessage(`Downloaded ${downloaded} plugin profile(s) into profiles/.`);
  } else {
    vscode.window.showWarningMessage("No profiles were downloaded — see the output.");
    context.channel.show();
  }
}
