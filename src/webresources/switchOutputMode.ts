import * as vscode from "vscode";
import fs = require("fs");
import path = require("path");
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";

// Switch the web-resource build output between the bundled library and
// one-file-per-web-resource (#88, user feedback on #109). The bin folder is
// cleared on change — stale artifacts from the OTHER mode would otherwise be
// swept up by the next deploy (deploy upserts everything in bin/**).

export async function switchWebresourceOutput(context: DataversePowerToolsContext): Promise<void> {
  const componentRoot = activeComponentRoot(context);
  if (!componentRoot) {
    vscode.window.showErrorMessage("Open a workspace folder first.");
    return;
  }
  const current = context.projectSettings.webresourceOutput === "perFile" ? "perFile" : "bundle";
  const pick = await vscode.window.showQuickPick(
    [
      { label: `${current === "bundle" ? "$(check) " : ""}Single bundled library`, description: "one <prefix>_library.js from library.ts", target: "bundle" as const },
      {
        label: `${current === "perFile" ? "$(check) " : ""}One file per web resource`,
        description: "one <prefix>_<name>.js per webresources_src/*.ts",
        target: "perFile" as const,
      },
    ],
    { placeHolder: `Web resource output mode (currently: ${current === "perFile" ? "one file per web resource" : "single bundled library"})` },
  );
  if (!pick || pick.target === current) {
    return;
  }

  context.projectSettings.webresourceOutput = pick.target;
  await context.writeSettings();

  // Clear generated output — bin/ contents from the other mode must not
  // survive into the next deploy.
  const binDir = path.join(componentRoot, "bin");
  if (fs.existsSync(binDir)) {
    for (const entry of await fs.promises.readdir(binDir)) {
      await fs.promises.rm(path.join(binDir, entry), { recursive: true, force: true });
    }
    context.channel.appendLine(`Cleared ${binDir} — rebuild to produce ${pick.target === "perFile" ? "per-file outputs" : "the bundled library"}.`);
  }
  context.refreshPanel?.();
  vscode.window.showInformationMessage(
    `Web resource output switched to ${pick.target === "perFile" ? "one file per web resource" : "the bundled library"}. Run Build to regenerate bin/.`,
  );
}
