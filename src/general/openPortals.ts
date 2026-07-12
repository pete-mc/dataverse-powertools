import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { parseConnectionString, getOrganizationUrl, normalizeOrganizationUrl } from "./connectionString";
import { parseAuthType, DataverseAuthType } from "./dataverse/authTypes";
import { discoverEnvironments, discoverEnvironmentsWithSecret } from "./dataverse/globalDiscovery";

// "Open Environment / Admin Center / Maker Portal" from the environment card.
// The environment itself opens by org URL; the admin center and maker portal
// address environments by GUID, which Global Discovery reports (EnvironmentId)
// and we persist in dataverse-powertools.json the first time it's needed.

export function adminCenterUrl(environmentId: string): string {
  return `https://admin.powerplatform.microsoft.com/environments/environment/${environmentId}/hub`;
}

export function makerPortalUrl(environmentId: string): string {
  return `https://make.powerapps.com/environments/${environmentId}/home`;
}

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function currentConnectionString(context: DataversePowerToolsContext): string {
  return context.connectionString || context.projectSettings.connectionString || "";
}

export async function openEnvironment(context: DataversePowerToolsContext): Promise<void> {
  const url = getOrganizationUrl(currentConnectionString(context));
  if (!url) {
    vscode.window.showErrorMessage("No Dataverse connection is configured.");
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

/** The environment GUID: from settings, else discovered with the current auth and
 * matched by org URL, else asked for — persisted to dataverse-powertools.json
 * either way so it's a one-time lookup. */
async function ensureEnvironmentId(context: DataversePowerToolsContext): Promise<string | undefined> {
  if (context.projectSettings.environmentId) {
    return context.projectSettings.environmentId;
  }

  const parts = parseConnectionString(currentConnectionString(context));
  const orgUrl = normalizeOrganizationUrl(getOrganizationUrl(currentConnectionString(context)) ?? "");
  let environments;
  if (parseAuthType(parts.authType) === DataverseAuthType.oauth) {
    environments = await discoverEnvironments(parts.clientId);
  } else if (parts.clientId && parts.clientSecret) {
    environments = await discoverEnvironmentsWithSecret(parts.clientId, parts.clientSecret, context.projectSettings.tenantId || parts.tenantId || "");
  }
  let environmentId = environments?.find((environment) => normalizeOrganizationUrl(environment.url) === orgUrl)?.environmentId;

  if (!environmentId) {
    // Discovery can't always see the environment (app-only discovery, manual URL) —
    // ask once; the Admin Center lists the ID under Environments → the environment.
    environmentId = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Environment ID (GUID — Power Platform Admin Center → Environments → your environment)",
      validateInput: (value) => (GUID_PATTERN.test((value ?? "").trim()) ? undefined : "Enter the environment GUID."),
    });
    environmentId = environmentId?.trim();
  }
  if (!environmentId) {
    return undefined;
  }

  context.projectSettings.environmentId = environmentId;
  await context.writeSettings();
  return environmentId;
}

export async function openAdminCenter(context: DataversePowerToolsContext): Promise<void> {
  const environmentId = await ensureEnvironmentId(context);
  if (environmentId) {
    await vscode.env.openExternal(vscode.Uri.parse(adminCenterUrl(environmentId)));
  }
}

export async function openMakerPortal(context: DataversePowerToolsContext): Promise<void> {
  const environmentId = await ensureEnvironmentId(context);
  if (environmentId) {
    await vscode.env.openExternal(vscode.Uri.parse(makerPortalUrl(environmentId)));
  }
}
