import fetch from "node-fetch";
import { DataverseContext, Options } from "./dataverseContext";
import DataversePowerToolsContext from "../../context";

export async function getDataverseMessages(context: DataversePowerToolsContext): Promise<string[]> {
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
    const url = context.dataverse?.organizationUrl + "/api/data/v9.1/sdkmessages?$select=name&$filter=isprivate eq false";
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

    const messages = data.value
      .map((record: any) => record.name || record.Name)
      .map((value: string | undefined) => (typeof value === "string" ? value.trim() : ""))
      .filter((value: string) => value.length > 0)
      .sort((a: string, b: string) => (a > b ? 1 : -1));

    return messages;
  } catch {
    return [];
  }
}
