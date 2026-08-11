// Lazy, session-scoped Dataverse metadata (#238).
//
// Deliberately NOT persisted to disk. The people using this are changing metadata while they use
// it — add a column in the maker portal, come back, expect to see it — so a cache that outlived the
// session would actively lie. In-memory for the session, cleared explicitly or whenever the
// connection changes, is both cheaper and more correct.
//
// Three tiers, each fetched on first use: the table list when the generator opens, a table's
// attributes when it is selected, its relationships when a join is added.
//
// The cache is pure (the fetcher is injected) → unit-tested without a network or `vscode`.

export interface TableMetadata {
  logicalName: string;
  displayName: string;
  /** Needed to build the Web API URL — `?fetchXml=` hangs off the entity SET name, not the
   * logical name, and getting this wrong is a 404 on every query. */
  entitySetName: string;
  primaryIdAttribute: string;
  primaryNameAttribute: string;
}

export interface AttributeMetadata {
  logicalName: string;
  displayName: string;
  /** Dataverse AttributeType, e.g. "Uniqueidentifier", "Lookup", "DateTime", "Picklist". */
  attributeType: string;
  /** Lookup targets, when this is a lookup. */
  targets?: string[];
}

export interface RelationshipMetadata {
  schemaName: string;
  kind: "OneToMany" | "ManyToOne" | "ManyToMany";
  /** The entity on the other end — the `name` of the `<link-entity>`. */
  relatedEntity: string;
  /** `from`/`to` as they should appear on the `<link-entity>` for this direction. */
  from: string;
  to: string;
  intersect?: boolean;
}

export interface MetadataFetcher {
  tables(): Promise<TableMetadata[]>;
  attributes(logicalName: string): Promise<AttributeMetadata[]>;
  relationships(logicalName: string): Promise<RelationshipMetadata[]>;
}

/** The read-only view diagnostics need. `undefined` means "not loaded", never "does not exist", so
 * an un-warmed cache produces no false warnings. */
export interface MetadataLookup {
  knownEntity(logicalName: string): boolean | undefined;
  knownAttribute(logicalName: string, attribute: string): boolean | undefined;
  attributeType(logicalName: string, attribute: string): string | undefined;
}

export interface MetadataCache extends MetadataLookup {
  getTables(): Promise<TableMetadata[]>;
  getAttributes(logicalName: string): Promise<AttributeMetadata[]>;
  getRelationships(logicalName: string): Promise<RelationshipMetadata[]>;
  entitySetName(logicalName: string): string | undefined;
  /** Already-loaded values, for a synchronous render — undefined means "not loaded yet". */
  loadedTables(): TableMetadata[] | undefined;
  loadedAttributes(logicalName: string): AttributeMetadata[] | undefined;
  clear(): void;
}

/** Share one in-flight promise per key so a burst of requests makes a single HTTP call. */
function memoize<K, V>(store: Map<K, V>, pending: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  const cached = store.get(key);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  const inFlight = pending.get(key);
  if (inFlight) {
    return inFlight;
  }
  const promise = load()
    .then((value) => {
      store.set(key, value);
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

export function createMetadataCache(fetcher: MetadataFetcher): MetadataCache {
  let tables: TableMetadata[] | undefined;
  let tablesPending: Promise<TableMetadata[]> | undefined;
  const attributes = new Map<string, AttributeMetadata[]>();
  const attributesPending = new Map<string, Promise<AttributeMetadata[]>>();
  const relationships = new Map<string, RelationshipMetadata[]>();
  const relationshipsPending = new Map<string, Promise<RelationshipMetadata[]>>();

  function attributeOf(logicalName: string, attribute: string): AttributeMetadata | undefined {
    return attributes.get(logicalName)?.find((candidate) => candidate.logicalName === attribute.toLowerCase());
  }

  return {
    getTables() {
      if (tables !== undefined) {
        return Promise.resolve(tables);
      }
      if (!tablesPending) {
        tablesPending = fetcher
          .tables()
          .then((loaded) => {
            tables = loaded;
            return loaded;
          })
          .finally(() => {
            tablesPending = undefined;
          });
      }
      return tablesPending;
    },

    getAttributes(logicalName) {
      return memoize(attributes, attributesPending, logicalName.toLowerCase(), () => fetcher.attributes(logicalName.toLowerCase()));
    },

    getRelationships(logicalName) {
      return memoize(relationships, relationshipsPending, logicalName.toLowerCase(), () => fetcher.relationships(logicalName.toLowerCase()));
    },

    entitySetName(logicalName) {
      return tables?.find((table) => table.logicalName === logicalName.toLowerCase())?.entitySetName;
    },

    loadedTables() {
      return tables;
    },

    loadedAttributes(logicalName) {
      return attributes.get(logicalName.toLowerCase());
    },

    knownEntity(logicalName) {
      return tables === undefined ? undefined : tables.some((table) => table.logicalName === logicalName.toLowerCase());
    },

    knownAttribute(logicalName, attribute) {
      return attributes.has(logicalName.toLowerCase()) ? attributeOf(logicalName, attribute) !== undefined : undefined;
    },

    attributeType(logicalName, attribute) {
      return attributeOf(logicalName, attribute)?.attributeType;
    },

    clear() {
      tables = undefined;
      tablesPending = undefined;
      attributes.clear();
      attributesPending.clear();
      relationships.clear();
      relationshipsPending.clear();
    },
  };
}
