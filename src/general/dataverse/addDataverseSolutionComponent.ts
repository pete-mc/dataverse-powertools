import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";
import { DataverseContext, Options } from "./dataverseContext";

async function ensureDataverseContext(context: DataversePowerToolsContext): Promise<boolean> {
  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
  }

  if (!context.dataverse.isValid) {
    return context.dataverse.initialize();
  }

  return true;
}

export async function addDataverseSolutionComponent(context: DataversePowerToolsContext, solutionUniqueName: string, componentType: number, componentId: string): Promise<boolean> {
  if (!solutionUniqueName) {
    return false;
  }

  const isReady = await ensureDataverseContext(context);
  if (!isReady || !context.dataverse.organizationUrl) {
    return false;
  }

  const token = await context.dataverse.getAuthorizationToken();
  if (!token) {
    return false;
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ComponentId: componentId,
      ComponentType: componentType,
      SolutionUniqueName: solutionUniqueName,
      AddRequiredComponents: false,
      DoNotIncludeSubcomponents: false,
    }),
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  const response = await fetch(`${context.dataverse.organizationUrl}/api/data/v9.1/AddSolutionComponent`, options);
  if (response.ok) {
    return true;
  }

  const responseText = await response.text();
  const alreadyInSolution = responseText.toLowerCase().includes("already") && responseText.toLowerCase().includes("solution");
  if (alreadyInSolution) {
    return true;
  }

  context.channel.appendLine(responseText);
  return false;
}

async function resolveSolutionComponentTypeByObjectId(context: DataversePowerToolsContext, componentId: string): Promise<number | undefined> {
  const isReady = await ensureDataverseContext(context);
  if (!isReady || !context.dataverse.organizationUrl) {
    return undefined;
  }

  const token = await context.dataverse.getAuthorizationToken();
  if (!token) {
    return undefined;
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  const response = await fetch(`${context.dataverse.organizationUrl}/api/data/v9.1/solutioncomponents?$select=componenttype,objectid&$filter=objectid eq ${componentId}`, options);

  if (!response.ok) {
    context.channel.appendLine(await response.text());
    return undefined;
  }

  const data: any = await response.json();
  const records: any[] = Array.isArray(data?.value) ? data.value : [];
  if (records.length === 0) {
    return undefined;
  }

  const componentType = records[0]?.componenttype;
  return typeof componentType === "number" ? componentType : undefined;
}

export async function addDataverseSolutionComponentByObjectId(context: DataversePowerToolsContext, solutionUniqueName: string, componentId: string): Promise<boolean> {
  const componentType = await resolveSolutionComponentTypeByObjectId(context, componentId);
  if (componentType === undefined) {
    context.channel.appendLine(`Could not resolve solution component type for object id '${componentId}'.`);
    return false;
  }

  return addDataverseSolutionComponent(context, solutionUniqueName, componentType, componentId);
}
