// Pure, vscode-free view-model builders for the actions panel. Extracted from
// panelState.ts so the settings→card field mapping and time formatting can be
// unit-tested without the vscode API or the filesystem (#143 Move 3). The fs/OS
// reads (spkl.json presence, downloaded-profile count, capture support) stay in
// panelState.ts and are passed in as `fsInfo`.

import { ProjectCardState } from "./menuModel";
import { ComponentSettings } from "../components/discovery";

/** Format an epoch timestamp as a short HH:MM local time; "" when undefined. */
export function clock(timestamp: number | undefined): string {
  if (timestamp === undefined) {
    return "";
  }
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The filesystem/OS-derived facts a project card needs — computed by the caller
 * (panelState.ts) so this builder stays pure. */
export interface ProjectCardFsInfo {
  /** whether a spkl.json sits at the component root */
  hasSpkl: boolean;
  /** profiles downloaded into <root>/profiles (plugins only; undefined otherwise) */
  downloadedProfiles: number | undefined;
  /** whether headless profiler capture is supported here (plugins on Windows) */
  captureSupported: boolean | undefined;
}

/** Map a component's settings + its fs facts into the panel's project-card state.
 * The name falls back solutionName → pluginProjectName → relativeRoot → "". */
export function buildProjectCard(settings: ComponentSettings, root: string, relativeRoot: string, isRoot: boolean, fsInfo: ProjectCardFsInfo): ProjectCardState {
  return {
    type: settings.type ?? "",
    name: (settings.solutionName as string) || (settings.pluginProjectName as string) || relativeRoot || "",
    relativeRoot,
    root,
    isRoot,
    detail: settings.pluginProjectName ? `${settings.pluginProjectName}.csproj` : undefined,
    templateVersion: settings.templateversion,
    hasPluginUnitTesting: !!settings.pluginUnitTestingEnabled,
    hasSpkl: fsInfo.hasSpkl,
    webresourceOutput: settings.webresourceOutput as "bundle" | "perFile" | undefined,
    // #145: the card's primary action follows the trigger (webhook leads with Register, others with Build).
    azureFunctionTrigger: settings.azureFunctionTrigger as string | undefined,
    downloadedProfiles: fsInfo.downloadedProfiles,
    captureSupported: fsInfo.captureSupported,
  };
}
