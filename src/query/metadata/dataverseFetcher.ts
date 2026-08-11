// The real metadata fetcher behind the cache (#238).
//
// Kept separate from cache.ts so the caching logic stays pure and unit-tested while this file holds
// only the HTTP shapes. Every call goes through the extension's own token, so it works identically
// under service-principal and interactive (OAuth) auth — no `tenantId` anywhere near it.

import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";
import { Options } from "../../general/dataverse/dataverseContext";
import { dataverseApiUrl, logDataverseHttpError } from "../../general/dataverse/webApi";
import { AttributeMetadata, MetadataFetcher, RelationshipMetadata, TableMetadata } from "./cache";

/* eslint-disable @typescript-eslint/naming-convention -- the metadata API's own property names. */
interface Label {
  UserLocalizedLabel?: { Label?: string } | null;
}
/* eslint-enable @typescript-eslint/naming-convention */

function labelText(label: Label | undefined | null, fallback: string): string {
  return label?.UserLocalizedLabel?.Label ?? fallback;
}

async function getJson(context: DataversePowerToolsContext, resource: string, operation: string): Promise<Record<string, unknown> | undefined> {
  const token = await context.dataverse.getAuthorizationToken();
  if (!token || !context.dataverse.organizationUrl) {
    return undefined;
  }
  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */

  const response = await fetch(dataverseApiUrl(context.dataverse.organizationUrl, resource), options);
  if (!response.ok) {
    await logDataverseHttpError(context.channel, operation, response);
    throw new Error(`${operation} failed with ${response.status}.`);
  }
  return (await response.json()) as Record<string, unknown>;
}

function records(payload: Record<string, unknown> | undefined): Record<string, unknown>[] {
  return Array.isArray(payload?.value) ? (payload?.value as Record<string, unknown>[]) : [];
}

export function createDataverseMetadataFetcher(context: DataversePowerToolsContext): MetadataFetcher {
  return {
    async tables(): Promise<TableMetadata[]> {
      // EntitySetName is the part the query URL needs; without it every run 404s.
      const payload = await getJson(
        context,
        "EntityDefinitions?$select=LogicalName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,DisplayName&$filter=IsPrivate eq false",
        "load table metadata",
      );
      return records(payload)
        .map((record) => ({
          logicalName: String(record.LogicalName ?? ""),
          displayName: labelText(record.DisplayName as Label, String(record.LogicalName ?? "")),
          entitySetName: String(record.EntitySetName ?? ""),
          primaryIdAttribute: String(record.PrimaryIdAttribute ?? ""),
          primaryNameAttribute: String(record.PrimaryNameAttribute ?? ""),
        }))
        .filter((table) => table.logicalName.length > 0)
        .sort((a, b) => a.logicalName.localeCompare(b.logicalName));
    },

    async attributes(logicalName: string): Promise<AttributeMetadata[]> {
      const escaped = logicalName.replace(/'/g, "''");
      const payload = await getJson(
        context,
        `EntityDefinitions(LogicalName='${escaped}')/Attributes?$select=LogicalName,AttributeType,DisplayName&$filter=AttributeOf eq null`,
        `load columns for '${logicalName}'`,
      );
      return records(payload)
        .map((record) => ({
          logicalName: String(record.LogicalName ?? ""),
          displayName: labelText(record.DisplayName as Label, String(record.LogicalName ?? "")),
          attributeType: String(record.AttributeType ?? ""),
        }))
        .filter((attribute) => attribute.logicalName.length > 0)
        .sort((a, b) => a.logicalName.localeCompare(b.logicalName));
    },

    async relationships(logicalName: string): Promise<RelationshipMetadata[]> {
      const escaped = logicalName.replace(/'/g, "''");
      const base = `EntityDefinitions(LogicalName='${escaped}')`;
      // Three collections, fetched in parallel so adding a join costs one round trip.
      const [oneToMany, manyToOne, manyToMany] = await Promise.all([
        getJson(
          context,
          `${base}/OneToManyRelationships?$select=SchemaName,ReferencingEntity,ReferencingAttribute,ReferencedEntity,ReferencedAttribute`,
          `load relationships for '${logicalName}'`,
        ),
        getJson(
          context,
          `${base}/ManyToOneRelationships?$select=SchemaName,ReferencingEntity,ReferencingAttribute,ReferencedEntity,ReferencedAttribute`,
          `load relationships for '${logicalName}'`,
        ),
        getJson(
          context,
          `${base}/ManyToManyRelationships?$select=SchemaName,Entity1LogicalName,Entity1IntersectAttribute,Entity2LogicalName,Entity2IntersectAttribute,IntersectEntityName`,
          `load relationships for '${logicalName}'`,
        ),
      ]);

      const found: RelationshipMetadata[] = [];

      // This entity is the PARENT: the join goes out to the child's foreign key.
      for (const record of records(oneToMany)) {
        found.push({
          schemaName: String(record.SchemaName ?? ""),
          kind: "OneToMany",
          relatedEntity: String(record.ReferencingEntity ?? ""),
          from: String(record.ReferencingAttribute ?? ""),
          to: String(record.ReferencedAttribute ?? ""),
        });
      }

      // This entity is the CHILD: the join goes up to the parent's primary key, so from/to swap.
      for (const record of records(manyToOne)) {
        found.push({
          schemaName: String(record.SchemaName ?? ""),
          kind: "ManyToOne",
          relatedEntity: String(record.ReferencedEntity ?? ""),
          from: String(record.ReferencedAttribute ?? ""),
          to: String(record.ReferencingAttribute ?? ""),
        });
      }

      // Many-to-many: the first hop is the intersect table, keyed on this entity's own column.
      for (const record of records(manyToMany)) {
        const isEntity1 = String(record.Entity1LogicalName ?? "").toLowerCase() === logicalName.toLowerCase();
        const ownAttribute = String((isEntity1 ? record.Entity1IntersectAttribute : record.Entity2IntersectAttribute) ?? "");
        found.push({
          schemaName: String(record.SchemaName ?? ""),
          kind: "ManyToMany",
          relatedEntity: String(record.IntersectEntityName ?? ""),
          from: ownAttribute,
          to: ownAttribute,
          intersect: true,
        });
      }

      return found.filter((relationship) => relationship.relatedEntity.length > 0).sort((a, b) => a.relatedEntity.localeCompare(b.relatedEntity));
    },
  };
}
