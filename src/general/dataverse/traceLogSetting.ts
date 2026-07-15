/* eslint-disable @typescript-eslint/naming-convention -- record fields are Dataverse logical names */
import type DataversePowerToolsContext from "../../context";
import { dataverseApiUrl, logDataverseError, logDataverseHttpError } from "./webApi";
import { canCallDataverseApi } from "./connectionReady";

// The org-wide plug-in trace-log level (#137): the `plugintracelogsetting` column on the
// single `organization` row. 0 = Off, 1 = Exception (errors only), 2 = All. Read on
// connect/refresh (cached by the panel) and written from the panel's trace-log tag.
// Works under BOTH auth types — the access token authorises the call, never gate on tenantId.
// `import type` on the context keeps this module `vscode`-free so the pure `traceLogLabel`
// can be imported by the panel view-model without pulling in the editor API.

export type TraceLogLevel = 0 | 1 | 2;

export interface TraceLogLabel {
  label: string;
  /** Pill colour by severity — green (off) → orange (errors) → red (all, has a cost). */
  colour: "green" | "orange" | "red";
}

/** Map a trace-log level to its pill label + colour (pure, unit-tested). */
export function traceLogLabel(value: TraceLogLevel): TraceLogLabel {
  switch (value) {
    case 1:
      return { label: "Trace: Errors", colour: "orange" };
    case 2:
      return { label: "Trace: All", colour: "red" };
    case 0:
    default:
      return { label: "Trace: Off", colour: "green" };
  }
}

/** The org row carrying the trace-log setting + the id needed to PATCH it (pure). */
export function organizationTraceLogQuery(): string {
  return "organizations?$select=organizationid,plugintracelogsetting";
}

interface OrganizationTraceRow {
  organizationid: string;
  plugintracelogsetting: TraceLogLevel;
}

async function getOrganizationTraceRow(context: DataversePowerToolsContext): Promise<OrganizationTraceRow | undefined> {
  const dataverse = context.dataverse;
  if (!dataverse || !canCallDataverseApi({ organizationUrl: dataverse.organizationUrl, isValid: dataverse.isValid })) {
    return undefined;
  }
  try {
    const url = dataverseApiUrl(dataverse.organizationUrl, organizationTraceLogQuery());
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: "Bearer " + (await dataverse.getAuthorizationToken()), "Content-Type": "application/json" },
    });
    if (!response.ok) {
      await logDataverseHttpError(context.channel, "read the plug-in trace log setting", response);
      return undefined;
    }
    const body: any = await response.json();
    const row = body?.value?.[0];
    if (!row || typeof row.organizationid !== "string") {
      return undefined;
    }
    const level = Number(row.plugintracelogsetting);
    return { organizationid: row.organizationid, plugintracelogsetting: (level === 1 || level === 2 ? level : 0) as TraceLogLevel };
  } catch (error) {
    logDataverseError(context.channel, "read the plug-in trace log setting", error);
    return undefined;
  }
}

/** Current org-wide plug-in trace-log level, or undefined when not connected / on failure. */
export async function getTraceLogSetting(context: DataversePowerToolsContext): Promise<TraceLogLevel | undefined> {
  const row = await getOrganizationTraceRow(context);
  return row ? row.plugintracelogsetting : undefined;
}

/** Set the org-wide plug-in trace-log level via PATCH organizations(<id>). Returns true on success. */
export async function setTraceLogSetting(context: DataversePowerToolsContext, value: TraceLogLevel): Promise<boolean> {
  const dataverse = context.dataverse;
  if (!dataverse || !canCallDataverseApi({ organizationUrl: dataverse.organizationUrl, isValid: dataverse.isValid })) {
    return false;
  }
  const row = await getOrganizationTraceRow(context);
  if (!row) {
    context.channel.appendLine("Could not resolve the organization row to set the plug-in trace log level — see the output.");
    return false;
  }
  try {
    const url = dataverseApiUrl(dataverse.organizationUrl, `organizations(${row.organizationid})`);
    const response = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: "Bearer " + (await dataverse.getAuthorizationToken()), "Content-Type": "application/json" },
      body: JSON.stringify({ plugintracelogsetting: value }),
    });
    if (!response.ok) {
      await logDataverseHttpError(context.channel, "set the plug-in trace log setting", response);
      return false;
    }
    return true;
  } catch (error) {
    logDataverseError(context.channel, "set the plug-in trace log setting", error);
    return false;
  }
}
