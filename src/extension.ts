import * as vscode from "vscode";
import * as cs from "./general/initialiseExtension";
import path = require("path");
import fs = require("fs");
import DataversePowerToolsContext, { ProjectTypes } from "./context";
import { pluginTableSelector } from "./plugins/pluginTables";
import { initialiseWebresources } from "./webresources/initialiseWebresources";
import { initialiseSolutions } from "./solution/initialiseSolutions";
import { initialisePortals } from "./portals/initialisePortals";
import { initialisePlugins } from "./plugins/initialisePlugins";

export async function activate(vscodeContext: vscode.ExtensionContext) {
  const context = new DataversePowerToolsContext(vscodeContext);
  context.channel.appendLine(fs.readFileSync(context.vscode.asAbsolutePath(path.join("templates", "logo.txt")), "utf8"));
  context.channel.appendLine(`version: ${vscodeContext.extension.packageJSON.version}`);
  await initialise(context);
}

export async function initialise(context: DataversePowerToolsContext) {
  await cs.generalInitialise(context);
  switch (context.projectSettings.type) {
    case ProjectTypes.webresource:
      await initialiseWebresources(context);
      break;
    case ProjectTypes.plugin:
      await initialisePlugins(context);
      await pluginTableSelector(context);
      break;
    case ProjectTypes.solution:
      await initialiseSolutions(context);
      break;
    case ProjectTypes.portal:
      await initialisePortals(context);
      break;
    case ProjectTypes.pcfdataset:
    case ProjectTypes.pcffield:
      throw new Error("Function not implemented.");
  }
}
