/* eslint-disable @typescript-eslint/naming-convention */
// Global Discovery Service: after an interactive sign-in, list every Dataverse
// environment the signed-in user can access, so the connection wizard can offer a
// pick-list instead of asking the user to type an org URL.

import fetch from "node-fetch";
import { acquireInteractiveForScopes, acquireClientSecretTokenForResource } from "./tokenAcquisition";

// The tenant-level discovery endpoint (not org-specific). Its resource maps to the
// Dataverse first-party app, so the default sign-in app's Dataverse permission covers it.
const GLOBAL_DISCOVERY_URL = "https://globaldisco.crm.dynamics.com/api/discovery/v2.0/Instances";
const GLOBAL_DISCOVERY_RESOURCE = "https://globaldisco.crm.dynamics.com";
const GLOBAL_DISCOVERY_SCOPES = ["https://globaldisco.crm.dynamics.com/.default"];

/** An environment ("instance") as the wizard needs it. */
export interface DataverseEnvironment {
  friendlyName: string;
  uniqueName: string;
  /** The environment's web url, e.g. https://org.crm.dynamics.com. */
  url: string;
  /** The environment GUID — what the Admin Center / Maker Portal URLs address. */
  environmentId?: string;
}

interface DiscoveryInstance {
  FriendlyName?: string;
  UniqueName?: string;
  Url?: string;
  ApiUrl?: string;
  State?: number;
  EnvironmentId?: string;
}

/**
 * Parse a Global Discovery v2.0 Instances response into environments. Pure so it can
 * be unit-tested. Keeps only enabled environments (State 0) that have a url, and sorts
 * by friendly name for a stable pick-list.
 */
export function parseInstances(json: unknown): DataverseEnvironment[] {
  const value = (json as { value?: DiscoveryInstance[] })?.value;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((instance) => instance && (instance.State === undefined || instance.State === 0) && !!instance.Url)
    .map((instance) => ({
      friendlyName: instance.FriendlyName || instance.UniqueName || (instance.Url as string),
      uniqueName: instance.UniqueName || "",
      url: instance.Url as string,
      environmentId: instance.EnvironmentId || undefined,
    }))
    .sort((a, b) => a.friendlyName.localeCompare(b.friendlyName));
}

/** Call the discovery service with an access token and parse the environments. */
async function callDiscovery(accessToken: string): Promise<DataverseEnvironment[] | undefined> {
  try {
    const response = await fetch(GLOBAL_DISCOVERY_URL, {
      method: "GET",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    });
    if (!response.ok) {
      return undefined;
    }
    return parseInstances(await response.json());
  } catch {
    return undefined;
  }
}

/**
 * Sign in interactively (if needed) and return the user's Dataverse environments.
 * Returns undefined if sign-in fails or the discovery call errors.
 */
export async function discoverEnvironments(clientId?: string): Promise<DataverseEnvironment[] | undefined> {
  const token = await acquireInteractiveForScopes(GLOBAL_DISCOVERY_SCOPES, clientId, true);
  return token?.accessToken ? callDiscovery(token.accessToken) : undefined;
}

/**
 * Return the environments a service principal (client secret) can reach via discovery.
 * App-only discovery only surfaces environments where the app is an application user,
 * so callers should fall back to a manual url when this comes back empty.
 */
export async function discoverEnvironmentsWithSecret(clientId: string, clientSecret: string, tenantId: string): Promise<DataverseEnvironment[] | undefined> {
  const token = await acquireClientSecretTokenForResource(clientId, clientSecret, tenantId, GLOBAL_DISCOVERY_RESOURCE);
  return token?.accessToken ? callDiscovery(token.accessToken) : undefined;
}
