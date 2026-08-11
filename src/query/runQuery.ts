// Running a query against the live environment (#238).
//
// Gated on `canCallDataverseApi` and NEVER on `tenantId` — interactive (OAuth) connections don't have
// one, and gating on it is the bug that shipped three times (#90/#91/#128).
//
// Two things the results view has to be told, because both silently change what a run means:
//   * the query ran as the CONNECTED identity, not as the plugin's calling user, so row-level
//     security and `eq-userid` resolve differently at runtime;
//   * rows are capped, so an unbounded query over a big table can't pull the whole table.

import fetch from "node-fetch";
import DataversePowerToolsContext from "../context";
import { DataverseContext, Options } from "../general/dataverse/dataverseContext";
import { canCallDataverseApi } from "../general/dataverse/connectionReady";
import { dataverseApiUrl, logDataverseHttpError } from "../general/dataverse/webApi";
import { minifyFetchXml, parseFetchXml } from "./fetchXml";
import { getMetadataCache } from "./metadataService";
import { ResultTable, flattenResults } from "./results";
import { QueryNode, attrBool, queryEntity } from "./queryModel";

/** Default row cap for a test run. A query in a generator is being explored, not exported. */
export const DEFAULT_ROW_CAP = 50;

export interface RunContext {
  organizationUrl: string;
  identity?: string;
  /** The cap actually applied, or undefined when the query set its own paging. */
  rowCap?: number;
}

export type RunOutcome = { ok: true; table: ResultTable; context: RunContext } | { ok: false; error: string };

/**
 * Apply the row cap. Only when the query hasn't asked for its own paging: overriding an explicit
 * `top`, `page` or `count` would change the query the user is actually testing.
 */
export function applyRowCap(root: QueryNode, cap: number): { root: QueryNode; applied?: number } {
  if (root.tag !== "fetch" || root.attrs.top !== undefined || root.attrs.page !== undefined || root.attrs.count !== undefined) {
    return { root };
  }
  const capped: QueryNode = { ...root, attrs: { ...root.attrs, top: String(cap) }, children: root.children };
  return { root: capped, applied: cap };
}

/** Resolve the entity set name for the query's table, loading table metadata if needed. */
async function entitySetFor(context: DataversePowerToolsContext, root: QueryNode): Promise<{ entitySet?: string; error?: string }> {
  const entity = queryEntity(root);
  const logicalName = entity?.attrs.name;
  if (!logicalName) {
    return { error: "The query has no <entity name='...'> to run against." };
  }
  if (logicalName.startsWith("@")) {
    return { error: `The table name is still a parameter (${logicalName}). Replace it with a table before running.` };
  }

  const cache = getMetadataCache(context);
  try {
    await cache.getTables();
  } catch (error) {
    return { error: `Could not load table metadata: ${(error as Error).message}` };
  }
  const entitySet = cache.entitySetName(logicalName);
  return entitySet ? { entitySet } : { error: `No table '${logicalName}' in this environment.` };
}

/**
 * Run FetchXML and return a flattened result table. `xml` must already have its parameters
 * substituted — this function does no token handling, so a token left in place is sent as a literal
 * and the org reports it, which is the honest outcome.
 */
export async function runFetchXml(context: DataversePowerToolsContext, xml: string, rowCap = DEFAULT_ROW_CAP): Promise<RunOutcome> {
  const parsed = parseFetchXml(xml);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  if (parsed.root.tag !== "fetch") {
    return { ok: false, error: "Only a whole <fetch> query can be run. A <filter> fragment has no table to run against." };
  }

  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
  }
  if (!context.dataverse.isValid) {
    await context.dataverse.initialize();
  }
  if (!canCallDataverseApi({ organizationUrl: context.dataverse.organizationUrl, isValid: context.dataverse.isValid })) {
    return { ok: false, error: "Connect to a Dataverse environment first." };
  }

  const { entitySet, error } = await entitySetFor(context, parsed.root);
  if (!entitySet) {
    return { ok: false, error: error ?? "Could not resolve the table." };
  }

  const { root, applied } = applyRowCap(parsed.root, rowCap);
  const runnable = minifyFetchXml(root);

  const token = await context.dataverse.getAuthorizationToken();
  if (!token) {
    return { ok: false, error: "No Dataverse token available." };
  }

  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      // Formatted values are what make the grid readable: without them an option set is an int and
      // a lookup is a guid. maxpagesize is a second belt on the row cap.
      Prefer: `odata.include-annotations="*"${applied === undefined ? "" : `,odata.maxpagesize=${applied}`}`,
    },
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  const url = dataverseApiUrl(context.dataverse.organizationUrl, `${entitySet}?fetchXml=${encodeURIComponent(runnable)}`);
  context.channel.appendLine(`[Query] GET ${entitySet} (${runnable.length} chars of FetchXML${applied === undefined ? "" : `, top ${applied}`})`);

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const body = await logDataverseHttpError(context.channel, `run the query against ${entitySet}`, response);
      return { ok: false, error: dataverseErrorMessage(body) ?? `The environment returned ${response.status}.` };
    }
    const table = flattenResults(await response.json());
    context.channel.appendLine(`[Query] ${table.rows.length} row(s) returned`);
    return {
      ok: true,
      table,
      context: { organizationUrl: context.dataverse.organizationUrl, identity: await getConnectedIdentity(context), rowCap: applied },
    };
  } catch (caught) {
    context.channel.appendLine(`[Query] Error: ${(caught as Error).message}`);
    return { ok: false, error: (caught as Error).message };
  }
}

/** Pull the human-readable message out of a Dataverse error body. */
export function dataverseErrorMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message;
  } catch {
    return body.length > 0 && body.length < 500 ? body : undefined;
  }
}

let cachedIdentity: { organizationUrl: string; name: string } | undefined;

/**
 * Who the query runs as. Worth two calls once per session: a run under a service principal returns
 * different rows than the user will see, and `eq-userid` resolves to THIS identity.
 */
export async function getConnectedIdentity(context: DataversePowerToolsContext): Promise<string | undefined> {
  const organizationUrl = context.dataverse?.organizationUrl;
  if (!organizationUrl) {
    return undefined;
  }
  if (cachedIdentity?.organizationUrl === organizationUrl) {
    return cachedIdentity.name;
  }
  try {
    const token = await context.dataverse.getAuthorizationToken();
    /* eslint-disable @typescript-eslint/naming-convention */
    const options = { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } } as Options;
    /* eslint-enable @typescript-eslint/naming-convention */
    const who = await fetch(dataverseApiUrl(organizationUrl, "WhoAmI"), options);
    if (!who.ok) {
      return undefined;
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention -- WhoAmI's own response shape.
    const { UserId: userId } = (await who.json()) as { UserId?: string };
    if (!userId) {
      return undefined;
    }
    const user = await fetch(dataverseApiUrl(organizationUrl, `systemusers(${userId})?$select=fullname`), options);
    if (!user.ok) {
      return undefined;
    }
    const { fullname } = (await user.json()) as { fullname?: string };
    if (fullname) {
      cachedIdentity = { organizationUrl, name: fullname };
    }
    return fullname;
  } catch {
    return undefined;
  }
}

/** Drop the cached identity — paired with clearing metadata when the connection changes. */
export function forgetConnectedIdentity(): void {
  cachedIdentity = undefined;
}

/** True when the query aggregates, which the results view labels differently. */
export function isAggregateQuery(root: QueryNode): boolean {
  return attrBool(root, "aggregate");
}
