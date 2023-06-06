import DataversePowerToolsContext from "../context";
import * as vscode from "vscode";
import { extractSolution } from "./extractSolution";
import { deploySolution } from "./deploySolution";
import { packSolution } from "./packSolution";

export function initialiseSolutions(context: DataversePowerToolsContext): void {
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPlugin", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isWebResource", false);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isSolution", true);
  vscode.commands.executeCommand("setContext", "dataverse-powertools.isPortal", false);
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.extractSolution", () => extractSolution(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.packSolution", () => packSolution(context)));
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.deploySolution", () => deploySolution(context)));
}
