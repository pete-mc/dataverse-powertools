import fetch from "node-fetch";
import * as fs from "fs";
import DataversePowerToolsContext from "../../context";
import { DataverseContext, Options } from "./dataverseContext";

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function isStrongNameRequiredError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return lower.includes("0x8004416c") || lower.includes("public assembly must have public key token");
}

function logStrongNameRequiredGuidance(context: DataversePowerToolsContext): void {
  context.channel.appendLine(
    "Dataverse pluginassembly API requires a strong-named assembly (public key token). " +
      "Unsigned assemblies from --skip-signing cannot be created/updated through pluginassembly endpoints.",
  );
  context.channel.appendLine("Options: sign the assembly for API-based deploy, or use package-based plugin deployment flow.");
}

export async function getDataversePluginAssemblyId(context: DataversePowerToolsContext, assemblyName: string): Promise<string | undefined> {
  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
    await context.dataverse.initialize();
  }

  const token = await context.dataverse.getAuthorizationToken();
  if (!token || !context.dataverse.organizationUrl) {
    return undefined;
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "GET",
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  try {
    const escapedAssemblyName = escapeODataString(assemblyName);
    const url = `${context.dataverse.organizationUrl}/api/data/v9.1/pluginassemblies?$select=pluginassemblyid,name&$filter=name eq '${escapedAssemblyName}'`;
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorText = await response.text();
      context.channel.appendLine(errorText);
      if (isStrongNameRequiredError(errorText)) {
        logStrongNameRequiredGuidance(context);
      }
      return undefined;
    }

    const data: any = await response.json();
    if (!data?.value || !Array.isArray(data.value) || data.value.length === 0) {
      return undefined;
    }

    return data.value[0]?.pluginassemblyid;
  } catch {
    return undefined;
  }
}

export async function createDataversePluginAssembly(context: DataversePowerToolsContext, assemblyName: string, assemblyPath: string): Promise<string | undefined> {
  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
    await context.dataverse.initialize();
  }

  const token = await context.dataverse.getAuthorizationToken();
  if (!token || !context.dataverse.organizationUrl) {
    return undefined;
  }

  const fileBuffer = await fs.promises.readFile(assemblyPath);
  const assemblyContentBase64 = fileBuffer.toString("base64");

  const payload = {
    name: assemblyName,
    content: assemblyContentBase64,
    sourcetype: 0,
    isolationmode: 2,
  };

  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
    body: JSON.stringify(payload),
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  try {
    const url = `${context.dataverse.organizationUrl}/api/data/v9.1/pluginassemblies`;
    const response = await fetch(url, options);
    if (!response.ok) {
      context.channel.appendLine(await response.text());
      return undefined;
    }

    const created = (await response.json()) as { pluginassemblyid?: string };
    return created.pluginassemblyid;
  } catch {
    return undefined;
  }
}

export async function ensureDataversePluginAssemblyId(
  context: DataversePowerToolsContext,
  assemblyName: string,
  assemblyPath: string,
): Promise<{ assemblyId?: string; created: boolean }> {
  const existingId = await getDataversePluginAssemblyId(context, assemblyName);
  if (existingId) {
    return { assemblyId: existingId, created: false };
  }

  const createdId = await createDataversePluginAssembly(context, assemblyName, assemblyPath);
  return { assemblyId: createdId, created: !!createdId };
}

export async function updateDataversePluginAssemblyContent(context: DataversePowerToolsContext, assemblyId: string, assemblyPath: string): Promise<boolean> {
  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
    await context.dataverse.initialize();
  }

  const token = await context.dataverse.getAuthorizationToken();
  if (!token || !context.dataverse.organizationUrl) {
    return false;
  }

  const fileBuffer = await fs.promises.readFile(assemblyPath);
  const assemblyContentBase64 = fileBuffer.toString("base64");

  const payload = {
    content: assemblyContentBase64,
  };

  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "PATCH",
    body: JSON.stringify(payload),
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  try {
    const url = `${context.dataverse.organizationUrl}/api/data/v9.1/pluginassemblies(${assemblyId})`;
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorText = await response.text();
      context.channel.appendLine(errorText);
      if (isStrongNameRequiredError(errorText)) {
        logStrongNameRequiredGuidance(context);
      }
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export async function upsertDataversePluginAssembly(
  context: DataversePowerToolsContext,
  assemblyName: string,
  assemblyPath: string,
): Promise<{ assemblyId?: string; created: boolean; updated: boolean }> {
  const existingId = await getDataversePluginAssemblyId(context, assemblyName);
  if (existingId) {
    const updated = await updateDataversePluginAssemblyContent(context, existingId, assemblyPath);
    return { assemblyId: existingId, created: false, updated };
  }

  const createdId = await createDataversePluginAssembly(context, assemblyName, assemblyPath);
  return { assemblyId: createdId, created: !!createdId, updated: false };
}
