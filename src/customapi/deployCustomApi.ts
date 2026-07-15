// VS Code / Web API orchestration for the Custom API metadata deploy (#142, #3).
// Pushes each *.customapi.json to Dataverse — create/update the CustomAPI record,
// then reconcile its request parameters + response properties (create/update, and
// DELETE any removed from the file), then add it to the project's solution.
//
// Gates on the LIVE connection (works under both auth types — never on tenantId,
// per #90/#91). The payload/reconcile logic is pure + unit-tested in
// deployPayloads.ts; this file is the HTTP glue, mirroring registerPluginSteps.ts.
//
// NB: pre-release — the create/update/delete calls have not yet been run against a
// live org (no headless Web API harness). The payload shapes and option-set values
// are docs-verified and unit-tested; verify against an environment before relying.

import fetch from "node-fetch";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";
import { DataverseContext, Options } from "../general/dataverse/dataverseContext";
import { dataverseApiUrl, logDataverseHttpError } from "../general/dataverse/webApi";
import { escapeODataString } from "../general/dataverse/odata";
import { addDataverseSolutionComponentByObjectId } from "../general/dataverse/addDataverseSolutionComponent";
import { CustomApiDefinition } from "./definition";
import { validateCustomApiDefinition } from "./validate";
import { findCustomApiDefinitionFiles } from "./customApiCommands";
import {
  buildCustomApiCreatePayload,
  buildCustomApiUpdatePayload,
  buildRequestParameterCreatePayload,
  buildResponsePropertyCreatePayload,
  buildMemberUpdatePayload,
  reconcileByUniqueName,
  ExistingNamedRecord,
} from "./deployPayloads";

async function ensureContext(context: DataversePowerToolsContext): Promise<boolean> {
  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
  }
  return context.dataverse.isValid ? true : context.dataverse.initialize();
}

function jsonHeaders(token: string): { headers: Record<string, string> } {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    },
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

async function getJson(context: DataversePowerToolsContext, relativeUrl: string): Promise<any | undefined> {
  const token = await context.dataverse.getAuthorizationToken();
  const baseUrl = context.dataverse.organizationUrl;
  if (!token || !baseUrl) {
    return undefined;
  }
  const response = await fetch(dataverseApiUrl(baseUrl, relativeUrl), { method: "GET", ...jsonHeaders(token) } as Options);
  if (!response.ok) {
    await logDataverseHttpError(context.channel, `GET ${relativeUrl}`, response);
    return undefined;
  }
  return response.json();
}

/** POST a record; returns the new record id (parsed from the OData-EntityId header) or undefined. */
async function createRecord(context: DataversePowerToolsContext, entitySet: string, payload: Record<string, unknown>): Promise<string | undefined> {
  const token = await context.dataverse.getAuthorizationToken();
  const baseUrl = context.dataverse.organizationUrl;
  if (!token || !baseUrl) {
    return undefined;
  }
  const response = await fetch(dataverseApiUrl(baseUrl, entitySet), { method: "POST", body: JSON.stringify(payload), ...jsonHeaders(token) } as Options);
  if (!response.ok) {
    await logDataverseHttpError(context.channel, `POST ${entitySet}`, response);
    return undefined;
  }
  const entityId = response.headers.get("OData-EntityId") || response.headers.get("odata-entityid") || "";
  const match = entityId.match(/\(([0-9a-fA-F-]{36})\)/);
  return match?.[1];
}

async function patchRecord(context: DataversePowerToolsContext, entitySet: string, id: string, payload: Record<string, unknown>): Promise<boolean> {
  const token = await context.dataverse.getAuthorizationToken();
  const baseUrl = context.dataverse.organizationUrl;
  if (!token || !baseUrl) {
    return false;
  }
  const response = await fetch(dataverseApiUrl(baseUrl, `${entitySet}(${id})`), { method: "PATCH", body: JSON.stringify(payload), ...jsonHeaders(token) } as Options);
  if (!response.ok) {
    await logDataverseHttpError(context.channel, `PATCH ${entitySet}(${id})`, response);
    return false;
  }
  return true;
}

async function deleteRecord(context: DataversePowerToolsContext, entitySet: string, id: string): Promise<boolean> {
  const token = await context.dataverse.getAuthorizationToken();
  const baseUrl = context.dataverse.organizationUrl;
  if (!token || !baseUrl) {
    return false;
  }
  const response = await fetch(dataverseApiUrl(baseUrl, `${entitySet}(${id})`), { method: "DELETE", ...jsonHeaders(token) } as Options);
  if (!response.ok && response.status !== 404) {
    await logDataverseHttpError(context.channel, `DELETE ${entitySet}(${id})`, response);
    return false;
  }
  return true;
}

async function resolvePluginTypeId(context: DataversePowerToolsContext, typeName: string): Promise<string | undefined> {
  const data = await getJson(context, `plugintypes?$select=plugintypeid,typename&$filter=typename eq '${escapeODataString(typeName)}'`);
  return Array.isArray(data?.value) && data.value.length > 0 ? data.value[0].plugintypeid : undefined;
}

async function findCustomApiId(context: DataversePowerToolsContext, uniqueName: string): Promise<string | undefined> {
  const data = await getJson(context, `customapis?$select=customapiid&$filter=uniquename eq '${escapeODataString(uniqueName)}'`);
  return Array.isArray(data?.value) && data.value.length > 0 ? data.value[0].customapiid : undefined;
}

async function existingMembers(context: DataversePowerToolsContext, entitySet: string, idField: string, customApiId: string): Promise<ExistingNamedRecord[]> {
  const data = await getJson(context, `${entitySet}?$select=${idField},uniquename&$filter=_customapiid_value eq ${customApiId}`);
  const rows: any[] = Array.isArray(data?.value) ? data.value : [];
  return rows.map((r) => ({ id: r[idField], uniquename: r.uniquename }));
}

/** Deploy one definition. Returns true on success. */
async function deployOne(context: DataversePowerToolsContext, def: CustomApiDefinition, solutionUniqueName?: string): Promise<boolean> {
  const pluginTypeId = await resolvePluginTypeId(context, def.pluginTypeName);
  if (!pluginTypeId) {
    context.channel.appendLine(`✗ ${def.uniqueName}: plugin type '${def.pluginTypeName}' not found in the environment — deploy & register the plugin first.`);
    return false;
  }

  let customApiId = await findCustomApiId(context, def.uniqueName);
  if (customApiId) {
    if (!(await patchRecord(context, "customapis", customApiId, buildCustomApiUpdatePayload(def, pluginTypeId)))) {
      return false;
    }
    context.channel.appendLine(`  Updated CustomAPI '${def.uniqueName}'.`);
  } else {
    customApiId = await createRecord(context, "customapis", buildCustomApiCreatePayload(def, pluginTypeId));
    if (!customApiId) {
      return false;
    }
    context.channel.appendLine(`  Created CustomAPI '${def.uniqueName}'.`);
  }

  // Reconcile request parameters.
  const reqPlan = reconcileByUniqueName(def.requestParameters, await existingMembers(context, "customapirequestparameters", "customapirequestparameterid", customApiId));
  for (const p of reqPlan.toCreate) {
    await createRecord(context, "customapirequestparameters", buildRequestParameterCreatePayload(p, customApiId));
  }
  for (const u of reqPlan.toUpdate) {
    await patchRecord(context, "customapirequestparameters", u.id, buildMemberUpdatePayload(u.desired));
  }
  for (const id of reqPlan.toDelete) {
    await deleteRecord(context, "customapirequestparameters", id);
  }

  // Reconcile response properties.
  const respPlan = reconcileByUniqueName(def.responseProperties, await existingMembers(context, "customapiresponseproperties", "customapiresponsepropertyid", customApiId));
  for (const p of respPlan.toCreate) {
    await createRecord(context, "customapiresponseproperties", buildResponsePropertyCreatePayload(p, customApiId));
  }
  for (const u of respPlan.toUpdate) {
    await patchRecord(context, "customapiresponseproperties", u.id, buildMemberUpdatePayload(u.desired));
  }
  for (const id of respPlan.toDelete) {
    await deleteRecord(context, "customapiresponseproperties", id);
  }

  context.channel.appendLine(
    `  Parameters: +${reqPlan.toCreate.length} ~${reqPlan.toUpdate.length} -${reqPlan.toDelete.length}; ` +
      `Response: +${respPlan.toCreate.length} ~${respPlan.toUpdate.length} -${respPlan.toDelete.length}.`,
  );

  if (solutionUniqueName) {
    const added = await addDataverseSolutionComponentByObjectId(context, solutionUniqueName, customApiId);
    context.channel.appendLine(added ? `  Added to solution '${solutionUniqueName}'.` : `  Could not add to solution '${solutionUniqueName}'.`);
  }

  return true;
}

/** Deploy every *.customapi.json in the active plugin component to Dataverse. */
export async function deployCustomApis(context: DataversePowerToolsContext): Promise<void> {
  const root = activeComponentRoot(context);
  if (!root) {
    vscode.window.showErrorMessage("Open or select a plugin component first.");
    return;
  }
  if (!(await ensureContext(context))) {
    vscode.window.showErrorMessage("Connect to a Dataverse environment first.");
    return;
  }

  const files = findCustomApiDefinitionFiles(root);
  if (files.length === 0) {
    vscode.window.showInformationMessage('No .customapi.json definitions found. Run "New Custom API definition" first.');
    return;
  }

  context.channel.show(true);
  const solutionUniqueName = context.projectSettings?.solutionName as string | undefined;
  let ok = 0;
  let failed = 0;

  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Deploying Custom APIs…" }, async () => {
    for (const file of files) {
      const name = path.basename(file);
      let def: CustomApiDefinition;
      try {
        def = JSON.parse(fs.readFileSync(file, "utf8")) as CustomApiDefinition;
      } catch (error) {
        context.channel.appendLine(`✗ ${name}: not valid JSON — ${(error as Error).message}`);
        failed++;
        continue;
      }
      const errors = validateCustomApiDefinition(def);
      if (errors.length > 0) {
        context.channel.appendLine(`✗ ${name}: ${errors.length} validation error(s) — fix before deploy.`);
        errors.forEach((e) => context.channel.appendLine(`    - ${e}`));
        failed++;
        continue;
      }
      context.channel.appendLine(`Deploying ${name}…`);
      if (await deployOne(context, def, solutionUniqueName)) {
        ok++;
      } else {
        failed++;
      }
    }
  });

  if (failed > 0) {
    vscode.window.showWarningMessage(`Custom API deploy: ${ok} succeeded, ${failed} failed. See the Dataverse PowerTools output.`);
  } else {
    vscode.window.showInformationMessage(`Custom API deploy: ${ok} deployed.`);
  }
}
