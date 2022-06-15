import * as vscode from "vscode";
import DataversePowerToolsContext from "../DataversePowerToolsContext";

export async function initialiseProject(context: DataversePowerToolsContext) {
    // Settings file test
    context.projectSettings.type = "plugin";
    context.projectSettings.templateversion = 1;
    context.projectSettings.connectionString = "my connection string";
    context.writeSettings();
}
