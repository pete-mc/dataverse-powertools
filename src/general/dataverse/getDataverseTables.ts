import fetch from "node-fetch";
import { DataverseContext, Options } from "./dataverseContext";
import DataversePowerToolsContext from "../../context";
import { dataverseApiUrl } from "./webApi";

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
    const url = dataverseApiUrl(context.dataverse?.organizationUrl, "EntityDefinitions?$select=LogicalName");
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
    const tables = data.value
      .map((record: any) => record.LogicalName)
      .map((name: string | undefined) => (typeof name === "string" ? name.trim() : ""))
      .filter((name: string) => name.length > 0);
    return tables;
  } catch {
    return [];
  }
}
