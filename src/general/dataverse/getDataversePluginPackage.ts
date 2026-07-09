import fetch from "node-fetch";
import * as fs from "fs";
import DataversePowerToolsContext from "../../context";
import { DataverseContext, Options } from "./dataverseContext";
import { dataverseApiUrl, logDataverseHttpError } from "./webApi";

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

async function ensureDataverseContext(context: DataversePowerToolsContext): Promise<boolean> {
  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
  }

  if (!context.dataverse.isValid) {
    return context.dataverse.initialize();
  }

  return true;
}

async function getTokenAndBaseUrl(context: DataversePowerToolsContext): Promise<{ token: string; baseUrl: string } | undefined> {
  if (!(await ensureDataverseContext(context))) {
    return undefined;
  }

  const token = await context.dataverse.getAuthorizationToken();
  const baseUrl = context.dataverse.organizationUrl;
  if (!token || !baseUrl) {
    return undefined;
  }

  return { token, baseUrl };
}

async function readPackageContentBase64(packagePath: string): Promise<string> {
  const fileBuffer = await fs.promises.readFile(packagePath);
  return fileBuffer.toString("base64");
}

function createRequestOptions(token: string, method: "GET" | "POST" | "PATCH", payload?: any): Options {
  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  if (payload !== undefined) {
    options.body = JSON.stringify(payload);
  }

  return options;
}

export interface PluginPackageMetadata {
  name: string;
  uniqueName: string;
  version: string;
}

export interface PluginPackageUpsertResult {
  pluginPackageId?: string;
  created: boolean;
  updated: boolean;
}

export async function getDataversePluginPackageId(context: DataversePowerToolsContext, uniqueName: string): Promise<string | undefined> {
  const auth = await getTokenAndBaseUrl(context);
  if (!auth) {
    return undefined;
  }

  const escapedUniqueName = escapeODataString(uniqueName);
  const url = dataverseApiUrl(auth.baseUrl, `pluginpackages?$select=pluginpackageid,uniquename,name&$filter=uniquename eq '${escapedUniqueName}'`);
  const response = await fetch(url, createRequestOptions(auth.token, "GET"));
  if (!response.ok) {
    await logDataverseHttpError(context.channel, `look up plugin package '${uniqueName}'`, response);
    return undefined;
  }

  const data: any = await response.json();
  if (!data?.value || !Array.isArray(data.value) || data.value.length === 0) {
    return undefined;
  }

  return data.value[0]?.pluginpackageid;
}

async function createDataversePluginPackage(context: DataversePowerToolsContext, metadata: PluginPackageMetadata, packagePath: string): Promise<string | undefined> {
  const auth = await getTokenAndBaseUrl(context);
  if (!auth) {
    return undefined;
  }

  const payload = {
    name: metadata.name,
    uniquename: metadata.uniqueName,
    version: metadata.version,
    content: await readPackageContentBase64(packagePath),
  };

  const url = dataverseApiUrl(auth.baseUrl, "pluginpackages");
  const response = await fetch(url, createRequestOptions(auth.token, "POST", payload));
  if (!response.ok) {
    await logDataverseHttpError(context.channel, `create plugin package '${metadata.uniqueName}'`, response);
    return undefined;
  }

  // Dataverse returns 204 No Content on create, with the new record's id in the
  // OData-EntityId header (there's no JSON body to parse unless return=representation
  // was requested). Read the id from the header, falling back to a body if present.
  const entityId = response.headers.get("OData-EntityId") ?? "";
  const idFromHeader = entityId.match(/\(([^)]+)\)/)?.[1];
  if (idFromHeader) {
    return idFromHeader;
  }
  try {
    return ((await response.json()) as { pluginpackageid?: string }).pluginpackageid;
  } catch {
    return undefined;
  }
}

async function updateDataversePluginPackage(context: DataversePowerToolsContext, pluginPackageId: string, metadata: PluginPackageMetadata, packagePath: string): Promise<boolean> {
  const auth = await getTokenAndBaseUrl(context);
  if (!auth) {
    return false;
  }

  const payload = {
    name: metadata.name,
    version: metadata.version,
    content: await readPackageContentBase64(packagePath),
  };

  const url = dataverseApiUrl(auth.baseUrl, `pluginpackages(${pluginPackageId})`);
  const response = await fetch(url, createRequestOptions(auth.token, "PATCH", payload));
  if (!response.ok) {
    await logDataverseHttpError(context.channel, `update plugin package '${metadata.uniqueName}'`, response);
    return false;
  }

  return true;
}

export async function upsertDataversePluginPackage(context: DataversePowerToolsContext, metadata: PluginPackageMetadata, packagePath: string): Promise<PluginPackageUpsertResult> {
  const existingId = await getDataversePluginPackageId(context, metadata.uniqueName);
  if (existingId) {
    const updated = await updateDataversePluginPackage(context, existingId, metadata, packagePath);
    if (updated) {
      context.channel.appendLine(`Plugin package '${metadata.uniqueName}' (v${metadata.version}) updated in Dataverse.`);
    }
    return { pluginPackageId: existingId, created: false, updated };
  }

  const createdId = await createDataversePluginPackage(context, metadata, packagePath);
  if (createdId) {
    context.channel.appendLine(`Plugin package '${metadata.uniqueName}' (v${metadata.version}) created in Dataverse (${createdId}).`);
  }
  return { pluginPackageId: createdId, created: !!createdId, updated: false };
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function waitForDataversePluginAssemblyFromPackage(
  context: DataversePowerToolsContext,
  pluginPackageId: string,
  assemblyName: string,
  maxWaitMs = 30000,
  pollIntervalMs = 2000,
): Promise<string | undefined> {
  const auth = await getTokenAndBaseUrl(context);
  if (!auth) {
    return undefined;
  }

  const escapedAssemblyName = escapeODataString(assemblyName);
  const query = dataverseApiUrl(auth.baseUrl, `pluginassemblies?$select=pluginassemblyid,name&$filter=_packageid_value eq ${pluginPackageId} and name eq '${escapedAssemblyName}'`);

  const startTime = Date.now();
  while (Date.now() - startTime <= maxWaitMs) {
    const response = await fetch(query, createRequestOptions(auth.token, "GET"));
    if (!response.ok) {
      await logDataverseHttpError(context.channel, `wait for plugin assembly '${assemblyName}'`, response);
      return undefined;
    }

    const data: any = await response.json();
    if (data?.value && Array.isArray(data.value) && data.value.length > 0) {
      return data.value[0]?.pluginassemblyid;
    }

    await sleep(pollIntervalMs);
  }

  return undefined;
}
