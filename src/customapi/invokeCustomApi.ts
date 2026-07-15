// VS Code / Web API "Run Custom API" command (#142, issue #4). Pick a definition,
// prompt for request-parameter values, call the API with the extension's token,
// and show the response — the inner-loop replacement for a Postman round-trip,
// correct-by-construction because the request comes from the same definition that
// was deployed. Gates on the live connection (both auth types). Request shaping is
// pure + unit-tested in invokePayloads.ts.
//
// v1 supports Global (unbound) Custom APIs. Pre-release: the HTTP call has not been
// exercised against a live org — verify before relying.

import fetch from "node-fetch";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";
import { DataverseContext, Options } from "../general/dataverse/dataverseContext";
import { dataverseApiUrl, logDataverseHttpError } from "../general/dataverse/webApi";
import { CustomApiDefinition } from "./definition";
import { validateCustomApiDefinition } from "./validate";
import { findCustomApiDefinitionFiles } from "./customApiCommands";
import { buildActionInvokeBody, buildFunctionInvokeUrl, coerceParameterValue } from "./invokePayloads";

async function pickDefinition(root: string): Promise<CustomApiDefinition | undefined> {
  const files = findCustomApiDefinitionFiles(root);
  if (files.length === 0) {
    vscode.window.showInformationMessage('No .customapi.json definitions found. Run "New Custom API definition" first.');
    return undefined;
  }

  let chosen: string | undefined = files[0];
  if (files.length > 1) {
    const picked = await vscode.window.showQuickPick(
      files.map((f) => path.basename(f)),
      { placeHolder: "Which Custom API do you want to run?" },
    );
    if (!picked) {
      return undefined;
    }
    chosen = files.find((f) => path.basename(f) === picked);
  }
  if (!chosen) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(chosen, "utf8")) as CustomApiDefinition;
  } catch (error) {
    vscode.window.showErrorMessage(`${path.basename(chosen)} is not valid JSON: ${(error as Error).message}`);
    return undefined;
  }
}

/** Prompt for each request parameter; returns undefined if the user cancels. */
async function promptForValues(def: CustomApiDefinition): Promise<Record<string, string> | undefined> {
  const values: Record<string, string> = {};
  for (const p of def.requestParameters) {
    const raw = await vscode.window.showInputBox({
      prompt: `${p.uniqueName} (${p.type})${p.isOptional ? " — optional, leave blank to omit" : ""}`,
      validateInput: (v) => {
        if (!v && !p.isOptional) {
          return `${p.uniqueName} is required.`;
        }
        if (v && (p.type === "Entity" || p.type === "EntityReference" || p.type === "EntityCollection")) {
          try {
            coerceParameterValue(p.type, v);
          } catch {
            return "Enter valid JSON for this parameter type.";
          }
        }
        return undefined;
      },
    });
    if (raw === undefined) {
      return undefined; // cancelled
    }
    values[p.uniqueName] = raw;
  }
  return values;
}

export async function invokeCustomApi(context: DataversePowerToolsContext): Promise<void> {
  const root = activeComponentRoot(context);
  if (!root) {
    vscode.window.showErrorMessage("Open or select a plugin component first.");
    return;
  }

  const def = await pickDefinition(root);
  if (!def) {
    return;
  }

  const errors = validateCustomApiDefinition(def);
  if (errors.length > 0) {
    context.channel.show(true);
    context.channel.appendLine(`Cannot run ${def.uniqueName}: ${errors.length} validation error(s).`);
    errors.forEach((e) => context.channel.appendLine(`  - ${e}`));
    return;
  }

  if (def.binding !== "Global") {
    vscode.window.showWarningMessage(
      `Running bound Custom APIs isn't supported yet — ${def.uniqueName} is bound to ${def.boundEntityLogicalName}. Use the generated TS client instead.`,
    );
    return;
  }

  const values = await promptForValues(def);
  if (values === undefined) {
    return;
  }

  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
  }
  if (!context.dataverse.isValid && !(await context.dataverse.initialize())) {
    vscode.window.showErrorMessage("Connect to a Dataverse environment first.");
    return;
  }
  const token = await context.dataverse.getAuthorizationToken();
  const baseUrl = context.dataverse.organizationUrl;
  if (!token || !baseUrl) {
    vscode.window.showErrorMessage("No Dataverse token available.");
    return;
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" };
  /* eslint-enable @typescript-eslint/naming-convention */

  const isFunction = def.isFunction;
  const relativeUrl = isFunction ? buildFunctionInvokeUrl(def, values) : def.uniqueName;

  context.channel.show(true);
  context.channel.appendLine(`\n${isFunction ? "GET" : "POST"} ${relativeUrl}`);

  try {
    const response = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Running ${def.uniqueName}…` }, async () => {
      return fetch(
        dataverseApiUrl(baseUrl, relativeUrl),
        (isFunction ? { method: "GET", headers } : { method: "POST", headers, body: JSON.stringify(buildActionInvokeBody(def, values)) }) as unknown as Options,
      );
    });

    if (!response.ok) {
      await logDataverseHttpError(context.channel, `run ${def.uniqueName}`, response);
      vscode.window.showWarningMessage(`${def.uniqueName} returned ${response.status}. See the Dataverse PowerTools output.`);
      return;
    }

    const text = await response.text();
    context.channel.appendLine(text ? `Response:\n${text}` : `(${response.status} — no content)`);
    vscode.window.showInformationMessage(`${def.uniqueName} ran successfully.`);
  } catch (error) {
    context.channel.appendLine(`Error running ${def.uniqueName}: ${(error as Error).message}`);
    vscode.window.showErrorMessage(`Could not run ${def.uniqueName}. See the Dataverse PowerTools output.`);
  }
}
