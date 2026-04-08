import fetch from "node-fetch";
import { DataverseContext, Options } from "./dataverseContext";
import DataversePowerToolsContext from "../../context";

export async function getDataverseTableAttributes(context: DataversePowerToolsContext, tableLogicalName: string): Promise<string[]> {
  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
    await context.dataverse.initialize();
  }

  const accessToken = await context.dataverse.getAuthorizationToken();
  if (!accessToken || !context.dataverse.organizationUrl) {
    return [];
  }

  const escapedTableLogicalName = tableLogicalName.replace(/'/g, "''");

  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "GET",
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  try {
    const url = `${context.dataverse.organizationUrl}/api/data/v9.1/EntityDefinitions(LogicalName='${escapedTableLogicalName}')/Attributes?$select=LogicalName&$filter=AttributeOf eq null`;
    const response = await fetch(url, options);
    if (!response.ok) {
      const data: any = await response.text();
      context.channel.appendLine(data);
      return [];
    }

    const data: any = await response.json();
    if (!data || !Array.isArray(data.value)) {
      return [];
    }

    return data.value
      .map((record: any) => record.LogicalName)
      .map((name: string | undefined) => (typeof name === "string" ? name.trim() : ""))
      .filter((name: string) => name.length > 0)
      .sort((a: string, b: string) => a.localeCompare(b));
  } catch {
    return [];
  }
}
