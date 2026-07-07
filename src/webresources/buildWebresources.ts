import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { runWebresourceBuild } from "./webpackBuild";

export async function buildWebresources(context: DataversePowerToolsContext) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Building Resources...",
    },
    async () => {
      await buildWebresourcesExec(context);
    },
  );
}

export async function buildWebresourcesExec(context: DataversePowerToolsContext): Promise<boolean> {
  return runWebresourceBuild(context);
}
