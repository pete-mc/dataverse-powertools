import DataversePowerToolsContext from "../context";
import * as vscode from "vscode";
import { connectPortal } from "./connectPortal";

export function initialisePortals(context: DataversePowerToolsContext): void {
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPlugin", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isWebResource", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isSolution", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPortal", true);
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.connectPortal", () => connectPortal(context, "connect")));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.downloadPortal", () => connectPortal(context, "download")));
}
