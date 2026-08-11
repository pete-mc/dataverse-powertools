// Session-scoped metadata caches, one per environment (#238).
//
// Keying on the organization URL means switching environment gets a fresh cache for free, with no
// listener to remember to wire up. Nothing is written to disk on purpose (see cache.ts): people are
// changing metadata while they use this, so a cache that outlived the session would lie.

import DataversePowerToolsContext from "../context";
import { MetadataCache, createMetadataCache } from "./metadata/cache";
import { createDataverseMetadataFetcher } from "./metadata/dataverseFetcher";
import { forgetConnectedIdentity } from "./runQuery";

const caches = new Map<string, MetadataCache>();

/** The cache for the currently connected environment, created on first use. */
export function getMetadataCache(context: DataversePowerToolsContext): MetadataCache {
  const key = context.dataverse?.organizationUrl ?? "";
  const existing = caches.get(key);
  if (existing) {
    return existing;
  }
  const cache = createMetadataCache(createDataverseMetadataFetcher(context));
  caches.set(key, cache);
  return cache;
}

/** Forget everything — the "Clear Metadata Cache" command, and any connection change. */
export function clearMetadataCaches(): void {
  for (const cache of caches.values()) {
    cache.clear();
  }
  caches.clear();
  forgetConnectedIdentity();
}
