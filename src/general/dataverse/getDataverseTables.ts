import fetch from "node-fetch";
import { DataverseContext, Options } from "./dataverseContext";
import DataversePowerToolsContext from "../../context";

export async function getDataverseTables(context: DataversePowerToolsContext): Promise<string[]> {
  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
    await context.dataverse.initialize();
  }
  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    headers: {
      Authorization: "Bearer " + context.dataverse?.authorizationToken,
      "Content-Type": "application/json",
    },
    method: "GET",
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */
  try {
    const url = context.dataverse?.organizationUrl + "/api/data/v9.1/EntityDefinitions?$select=LogicalName";
    const response = await fetch(url, options);
    if (!response.ok) {
      const data: any = await response.text();
      context.channel.appendLine(data);
      return [];
    }
    const data: any = await response.json();
    if (data === null) {
      return [];
    }
    const tables = data.value.map((record: any) => record.LogicalName);
    return tables;
  } catch {
    return [];
  }
}
