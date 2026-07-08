// Single source of truth for the Dataverse Web API base URL + version, so call sites
// don't hand-build `${org}/api/data/v9.x/...` inconsistently (versions were mixed).

/** The Web API version the extension targets. */
export const DATAVERSE_API_VERSION = "v9.2";

/**
 * Build a Dataverse Web API URL from the organization URL and a resource path, e.g.
 * dataverseApiUrl("https://org.crm.dynamics.com", "WhoAmI") ->
 * "https://org.crm.dynamics.com/api/data/v9.2/WhoAmI". Tolerates leading/trailing
 * slashes on either part.
 */
export function dataverseApiUrl(organizationUrl: string | undefined | null, resourcePath: string): string {
  const base = (organizationUrl ?? "").replace(/\/+$/, "");
  const resource = (resourcePath ?? "").replace(/^\/+/, "");
  return `${base}/api/data/${DATAVERSE_API_VERSION}/${resource}`;
}
