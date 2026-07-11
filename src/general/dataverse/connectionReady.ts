// Pure connection-readiness predicate shared by the Dataverse Web API callers (forms, publish).
// Kept vscode-free so it is unit-tested in one place.

export interface DataverseApiReadiness {
  organizationUrl?: string;
  isValid?: boolean;
}

/**
 * Whether a live Dataverse Web API call can be attempted.
 *
 * Deliberately independent of `tenantId`: that is a service-principal-only field which interactive
 * (OAuth) sign-in never populates. Guards that required it silently failed under interactive auth —
 * "Register Form Events" reported "Could not connect to dataverse." and publish steps no-op'd — even
 * though the connection was valid and its token works for both auth types. The access token is what
 * actually authorizes the call, not the tenant id.
 */
export function canCallDataverseApi(state: DataverseApiReadiness): boolean {
  return !!state.organizationUrl && !!state.isValid;
}
