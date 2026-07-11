import DataversePowerToolsContext from "../../context";
import { dataverseApiUrl, logDataverseError, logDataverseHttpError } from "./webApi";
import { canCallDataverseApi } from "./connectionReady";

// Plugin trace logs via the Web API (#63 phase 1). Read-only. Works under BOTH
// auth types — the access token authorises the call, never gate on tenantId.

export interface PluginTraceLogRecord {
  plugintracelogid: string;
  typename?: string;
  messagename?: string;
  primaryentity?: string;
  operationtype?: number;
  mode?: number;
  depth?: number;
  performanceexecutionduration?: number;
  exceptiondetails?: string;
  messageblock?: string;
  correlationid?: string;
  createdon?: string;
}

const SELECT_FIELDS = [
  "plugintracelogid",
  "typename",
  "messagename",
  "primaryentity",
  "operationtype",
  "mode",
  "depth",
  "performanceexecutionduration",
  "exceptiondetails",
  "messageblock",
  "correlationid",
  "createdon",
].join(",");

/** Latest plugin trace logs, newest first. Returns undefined on failure (logged). */
export async function getPluginTraceLogs(context: DataversePowerToolsContext, top: number = 50): Promise<PluginTraceLogRecord[] | undefined> {
  const dataverse = context.dataverse;
  if (!dataverse || !canCallDataverseApi({ organizationUrl: dataverse.organizationUrl, isValid: dataverse.isValid })) {
    return undefined;
  }
  try {
    const url = dataverseApiUrl(dataverse.organizationUrl, `plugintracelogs?$select=${SELECT_FIELDS}&$orderby=createdon desc&$top=${top}`);
    const response = await fetch(url, {
      method: "GET",
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { Authorization: "Bearer " + (await dataverse.getAuthorizationToken()), "Content-Type": "application/json" },
    });
    if (!response.ok) {
      await logDataverseHttpError(context.channel, "Fetch plugin trace logs", response);
      return undefined;
    }
    const body = (await response.json()) as { value?: PluginTraceLogRecord[] };
    return body.value ?? [];
  } catch (error) {
    logDataverseError(context.channel, "Fetch plugin trace logs", error);
    return undefined;
  }
}
