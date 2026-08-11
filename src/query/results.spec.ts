import { describe, it, expect, vi } from "vitest";
import { flattenResults, resultsToCsv } from "./results";
import { AttributeMetadata, MetadataFetcher, RelationshipMetadata, TableMetadata, createMetadataCache } from "./metadata/cache";

/* eslint-disable @typescript-eslint/naming-convention -- these ARE the Web API's key names; the
   point of the fixture is that they match the wire format exactly. */
/** A response shaped exactly like the Web API's: annotations, aliases and a lookup raw value. */
const RESPONSE = {
  "@odata.context": "https://org.crm.dynamics.com/api/data/v9.2/$metadata#incidents",
  "@Microsoft.Dynamics.CRM.totalrecordcount": 2,
  "@Microsoft.Dynamics.CRM.morerecords": true,
  "@Microsoft.Dynamics.CRM.fetchxmlpagingcookie": "<cookie page='1' />",
  value: [
    {
      "@odata.etag": 'W/"123"',
      title: "Broken widget",
      statecode: 0,
      "statecode@OData.Community.Display.V1.FormattedValue": "Active",
      _customerid_value: "6b29fc40-ca47-1067-b31d-00dd010662da",
      "_customerid_value@OData.Community.Display.V1.FormattedValue": "Contoso Ltd",
      "c.fullname": "Ada Lovelace",
      incidentid: "aaaaaaaa-0000-0000-0000-000000000000",
    },
    {
      title: "Late delivery",
      statecode: 1,
      "statecode@OData.Community.Display.V1.FormattedValue": "Resolved",
      _customerid_value: null,
      "c.fullname": null,
      incidentid: "bbbbbbbb-0000-0000-0000-000000000000",
      ticketnumber: "CAS-01",
    },
  ],
};
/* eslint-enable @typescript-eslint/naming-convention */

describe("flattening a response", () => {
  const table = flattenResults(RESPONSE);

  it("drops odata annotations from the columns", () => {
    expect(table.columns.map((column) => column.key)).toEqual(["title", "statecode", "_customerid_value", "c.fullname", "incidentid", "ticketnumber"]);
    expect(table.columns.some((column) => column.key.includes("@"))).toBe(false);
  });

  it("labels a lookup's raw value readably", () => {
    expect(table.columns.find((column) => column.key === "_customerid_value")?.label).toBe("customerid");
  });

  it("keeps a link-entity alias column as its own column", () => {
    expect(table.rows[0].cells["c.fullname"]).toBe("Ada Lovelace");
  });

  it("shows formatted values, not raw option-set ints or lookup guids", () => {
    expect(table.rows[0].cells.statecode).toBe("Active");
    expect(table.rows[1].cells.statecode).toBe("Resolved");
    expect(table.rows[0].cells._customerid_value).toBe("Contoso Ltd");
  });

  it("keeps the raw record available for copy and record links", () => {
    expect(table.rows[0].raw.statecode).toBe(0);
    expect(table.rows[0].raw._customerid_value).toBe("6b29fc40-ca47-1067-b31d-00dd010662da");
  });

  it("renders nulls as empty rather than the string null", () => {
    expect(table.rows[1].cells["c.fullname"]).toBe("");
    expect(table.rows[1].cells._customerid_value).toBe("");
  });

  it("picks up a column that only appears on a later row", () => {
    expect(table.columns.map((column) => column.key)).toContain("ticketnumber");
    expect(table.rows[0].cells.ticketnumber).toBeUndefined();
  });

  it("reads the paging and count annotations", () => {
    expect(table.totalRecordCount).toBe(2);
    expect(table.moreRecords).toBe(true);
    expect(table.pagingCookie).toContain("cookie");
  });

  it("survives an empty or malformed payload", () => {
    expect(flattenResults({ value: [] })).toEqual({ columns: [], rows: [] });
    expect(flattenResults(undefined)).toEqual({ columns: [], rows: [] });
    expect(flattenResults({ nope: 1 })).toEqual({ columns: [], rows: [] });
  });

  it("stringifies a nested object rather than showing [object Object]", () => {
    const nested = flattenResults({ value: [{ thing: { a: 1 } }] });
    expect(nested.rows[0].cells.thing).toBe('{"a":1}');
  });
});

describe("csv export", () => {
  it("writes a header and quotes values containing commas or quotes", () => {
    const csv = resultsToCsv(flattenResults({ value: [{ name: 'Contoso, "the" Ltd', n: 1 }] }));
    expect(csv).toBe('name,n\n"Contoso, ""the"" Ltd",1');
  });
});

describe("metadata cache", () => {
  const tables: TableMetadata[] = [
    { logicalName: "account", displayName: "Account", entitySetName: "accounts", primaryIdAttribute: "accountid", primaryNameAttribute: "name" },
    { logicalName: "incident", displayName: "Case", entitySetName: "incidents", primaryIdAttribute: "incidentid", primaryNameAttribute: "title" },
  ];
  const attributes: AttributeMetadata[] = [
    { logicalName: "name", displayName: "Name", attributeType: "String" },
    { logicalName: "accountid", displayName: "Account", attributeType: "Uniqueidentifier" },
  ];
  const relationships: RelationshipMetadata[] = [
    { schemaName: "contact_customer_accounts", kind: "OneToMany", relatedEntity: "contact", from: "parentcustomerid", to: "accountid" },
  ];

  function fetcher(): MetadataFetcher & { calls: { tables: number; attributes: number; relationships: number } } {
    const calls = { tables: 0, attributes: 0, relationships: 0 };
    return {
      calls,
      tables: vi.fn(async () => {
        calls.tables++;
        return tables;
      }),
      attributes: vi.fn(async () => {
        calls.attributes++;
        return attributes;
      }),
      relationships: vi.fn(async () => {
        calls.relationships++;
        return relationships;
      }),
    };
  }

  it("fetches lazily and only once per key", async () => {
    const source = fetcher();
    const cache = createMetadataCache(source);
    expect(source.calls.tables).toBe(0);

    await cache.getTables();
    await cache.getTables();
    expect(source.calls.tables).toBe(1);

    await cache.getAttributes("account");
    await cache.getAttributes("ACCOUNT");
    expect(source.calls.attributes).toBe(1);

    await cache.getRelationships("account");
    await cache.getRelationships("account");
    expect(source.calls.relationships).toBe(1);
  });

  it("collapses a concurrent burst into a single request", async () => {
    const source = fetcher();
    const cache = createMetadataCache(source);
    await Promise.all([cache.getTables(), cache.getTables(), cache.getTables()]);
    expect(source.calls.tables).toBe(1);
    await Promise.all([cache.getAttributes("account"), cache.getAttributes("account")]);
    expect(source.calls.attributes).toBe(1);
  });

  it("resolves the entity SET name, which the query URL needs", async () => {
    const cache = createMetadataCache(fetcher());
    expect(cache.entitySetName("incident")).toBeUndefined();
    await cache.getTables();
    expect(cache.entitySetName("incident")).toBe("incidents");
    expect(cache.entitySetName("INCIDENT")).toBe("incidents");
  });

  it("answers 'not loaded' as undefined and never as 'does not exist'", async () => {
    const cache = createMetadataCache(fetcher());
    expect(cache.knownEntity("account")).toBeUndefined();
    expect(cache.knownAttribute("account", "name")).toBeUndefined();
    expect(cache.attributeType("account", "name")).toBeUndefined();

    await cache.getTables();
    expect(cache.knownEntity("account")).toBe(true);
    expect(cache.knownEntity("nosuchtable")).toBe(false);
    // Still undefined: this table's attributes have not been asked for yet.
    expect(cache.knownAttribute("account", "name")).toBeUndefined();

    await cache.getAttributes("account");
    expect(cache.knownAttribute("account", "name")).toBe(true);
    expect(cache.knownAttribute("account", "nope")).toBe(false);
    expect(cache.attributeType("account", "accountid")).toBe("Uniqueidentifier");
  });

  it("re-fetches after a clear, so a column added in the maker portal shows up", async () => {
    const source = fetcher();
    const cache = createMetadataCache(source);
    await cache.getTables();
    await cache.getAttributes("account");

    cache.clear();
    expect(cache.knownEntity("account")).toBeUndefined();
    expect(cache.loadedTables()).toBeUndefined();

    await cache.getTables();
    await cache.getAttributes("account");
    expect(source.calls.tables).toBe(2);
    expect(source.calls.attributes).toBe(2);
  });

  it("does not cache a failure, so a transient error can be retried", async () => {
    let attempts = 0;
    const cache = createMetadataCache({
      tables: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("offline");
        }
        return tables;
      },
      attributes: async () => [],
      relationships: async () => [],
    });

    await expect(cache.getTables()).rejects.toThrow("offline");
    await expect(cache.getTables()).resolves.toEqual(tables);
  });
});
