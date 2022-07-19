import * as vscode from "vscode";
import DataversePowerToolsContext, { ProjectTypes } from "../DataversePowerToolsContext";

export async function initialiseProject(context: DataversePowerToolsContext) {
    // Settings file test
    context.projectSettings.type = ProjectTypes.plugin;
    context.projectSettings.templateversion = 1;
    // context.projectSettings.connectionString = "my connection string";
    context.createSettings();
}

export async function readProject(context: DataversePowerToolsContext) {
    context.readSettings();
}
