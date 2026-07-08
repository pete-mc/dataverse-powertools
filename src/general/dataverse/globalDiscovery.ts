/* eslint-disable @typescript-eslint/naming-convention */
// Global Discovery Service: after an interactive sign-in, list every Dataverse
// environment the signed-in user can access, so the connection wizard can offer a
// pick-list instead of asking the user to type an org URL.

import fetch from "node-fetch";
import { acquireInteractiveForScopes } from "./tokenAcquisition";

// The tenant-level discovery endpoint (not org-specific). Its resource maps to the
// Dataverse first-party app, so the default sign-in app's Dataverse permission covers it.
const GLOBAL_DISCOVERY_URL = "https://globaldisco.crm.dynamics.com/api/discovery/v2.0/Instances";
const GLOBAL_DISCOVERY_SCOPES = ["https://globaldisco.crm.dynamics.com/.default"];

/** An environment ("instance") as the wizard needs it. */
export interface DataverseEnvironment {
  friendlyName: string;
  uniqueName: string;
  /** The environment's web url, e.g. https://org.crm.dynamics.com. */
  url: string;
}

interface DiscoveryInstance {
  FriendlyName?: string;
  UniqueName?: string;
  Url?: string;
  ApiUrl?: string;
  State?: number;
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
    }))
    .sort((a, b) => a.friendlyName.localeCompare(b.friendlyName));
}

/**
 * Sign in interactively (if needed) and return the user's Dataverse environments.
 * Returns undefined if sign-in fails or the discovery call errors.
 */
export async function discoverEnvironments(clientId?: string): Promise<DataverseEnvironment[] | undefined> {
  const token = await acquireInteractiveForScopes(GLOBAL_DISCOVERY_SCOPES, clientId, true);
  if (!token?.accessToken) {
    return undefined;
  }
  try {
    const response = await fetch(GLOBAL_DISCOVERY_URL, {
      method: "GET",

      headers: { Authorization: "Bearer " + token.accessToken, "Content-Type": "application/json" },
    });
    if (!response.ok) {
      return undefined;
    }
    return parseInstances(await response.json());
  } catch {
    return undefined;
  }
}
