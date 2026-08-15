import { DataverseAuthType } from "./dataverse/authTypes";
import { buildAuthConnectionString, mergeCredentialConnectionString } from "./connectionString";

// The connection wizard's routing and its output, as pure functions.
//
// The wizard itself (createServicePrincipalString in connectionStringManager.ts) is a closure over
// `vscode` input boxes and quick picks, so none of it could be tested — yet the decisions it makes
// are exactly the recurring bug class this repo keeps re-shipping: an interactive (OAuth) connection
// has NO tenant id and NO client secret, so any step that assumes those exist either asks the user
// for something meaningless or silently produces a connection string that can't authenticate
// (#90, #91, #128, #129, #135).
//
// The steps stay in the wizard; the branching between them lives here.

/** The wizard's steps, named as the routing refers to them. */
export type WizardStep = "environment" | "tenantId" | "manualUrl" | "solutionName" | "manualSolutionName" | "done";

export interface WizardCredentials {
  authType: DataverseAuthType;
  organisationUrl?: string;
  applicationId?: string;
  clientSecret?: string;
}

/**
 * Interactive discovers the environment straight away — it signs in as the user, so there is
 * nothing to collect first. Service principal must collect tenant + app id + secret before it has
 * anything to authenticate discovery with.
 */
export function stepAfterAuthType(authType: DataverseAuthType): "environment" | "tenantId" {
  return authType === DataverseAuthType.oauth ? "environment" : "tenantId";
}

/**
 * After Global Discovery. App-only discovery only sees environments where the app is an
 * application user, so an empty list is normal rather than an error — fall back to typing the URL.
 * Cancelling the pick lands in the same place: the user may know a URL discovery can't see.
 */
export function stepAfterEnvironmentDiscovery(result: { environmentCount: number; picked: boolean }): "manualUrl" | "solutionName" {
  return result.environmentCount > 0 && result.picked ? "solutionName" : "manualUrl";
}

/**
 * Whether the wizard can open a live connection to list solutions, or must ask the user to type
 * the solution's schema name.
 *
 * The asymmetry is the point: interactive needs only a URL (the client id is optional — it falls
 * back to the default public client), while service principal additionally needs BOTH halves of
 * the credential. Requiring a client id under interactive is precisely the mistake that has
 * shipped repeatedly.
 */
export function canListSolutions(credentials: WizardCredentials): boolean {
  if (!credentials.organisationUrl) {
    return false;
  }
  if (credentials.authType === DataverseAuthType.oauth) {
    return true;
  }
  return Boolean(credentials.applicationId) && Boolean(credentials.clientSecret);
}

/** A solution chosen from the live list supplies the publisher prefix too, so we needn't ask. */
export function stepAfterSolutionPick(solutionName: string | undefined): "manualSolutionName" | "done" {
  return solutionName ? "done" : "manualSolutionName";
}

/** Only prompt for a prefix when nothing supplied one. */
export function needsPrefixPrompt(prefix: string | null | undefined): boolean {
  return prefix === null || prefix === undefined || prefix === "";
}

/**
 * The connection string the wizard produces.
 *
 * `storedCredentials` is the `ClientId=…;ClientSecret=…` pair from secret storage, used when the
 * user did not re-enter a secret. It is merged through the parser rather than concatenated —
 * gluing `Url=<url>` to `ClientId=…` without a separator is a shipped bug this repo has already
 * paid for once (see mergeCredentialConnectionString).
 */
export function buildWizardConnectionString(state: WizardCredentials & { saveCredential?: boolean }, storedCredentials?: string): string {
  const url = state.organisationUrl ?? "";
  if (state.authType === DataverseAuthType.oauth) {
    // Nothing sensitive: no secret to store, and no tenant — the signed-in account carries both.
    return buildAuthConnectionString({ authType: "OAuth", url, clientId: state.applicationId });
  }
  if (state.saveCredential) {
    return buildAuthConnectionString({ authType: "ClientSecret", url, clientId: state.applicationId, clientSecret: state.clientSecret });
  }
  return mergeCredentialConnectionString(buildAuthConnectionString({ authType: "ClientSecret", url }), storedCredentials);
}

/**
 * The connection string used mid-wizard to list solutions — same shape as the final one, minus any
 * dependence on what the user chose to save. Built through the same helper so the string that
 * lists solutions cannot differ from the one that is persisted.
 */
export function listSolutionsConnectionString(credentials: WizardCredentials): string {
  return buildWizardConnectionString({ ...credentials, saveCredential: true });
}
