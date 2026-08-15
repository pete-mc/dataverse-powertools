import { describe, it, expect } from "vitest";
import { DataverseAuthType } from "./dataverse/authTypes";
import { parseConnectionString } from "./connectionString";
import {
  stepAfterAuthType,
  stepAfterEnvironmentDiscovery,
  canListSolutions,
  stepAfterSolutionPick,
  needsPrefixPrompt,
  buildWizardConnectionString,
  listSolutionsConnectionString,
} from "./connectionWizardFlow";

const oauth = DataverseAuthType.oauth;
const clientSecret = DataverseAuthType.clientSecret;

describe("stepAfterAuthType", () => {
  it("sends interactive straight to environment discovery — there is no tenant to ask for", () => {
    expect(stepAfterAuthType(oauth)).toBe("environment");
  });

  it("collects the tenant first for a service principal", () => {
    expect(stepAfterAuthType(clientSecret)).toBe("tenantId");
  });
});

describe("stepAfterEnvironmentDiscovery", () => {
  it("continues to solution selection when the user picked one", () => {
    expect(stepAfterEnvironmentDiscovery({ environmentCount: 3, picked: true })).toBe("solutionName");
  });

  // App-only discovery only sees environments where the app is an application user, so an empty
  // list is a normal outcome, not a failure.
  it("falls back to a typed URL when discovery returned nothing", () => {
    expect(stepAfterEnvironmentDiscovery({ environmentCount: 0, picked: false })).toBe("manualUrl");
  });

  it("falls back to a typed URL when the user dismissed the pick — they may know a URL discovery can't see", () => {
    expect(stepAfterEnvironmentDiscovery({ environmentCount: 5, picked: false })).toBe("manualUrl");
  });
});

describe("canListSolutions", () => {
  it("needs only a URL under interactive — the signed-in user is the credential", () => {
    expect(canListSolutions({ authType: oauth, organisationUrl: "https://org.crm.dynamics.com" })).toBe(true);
  });

  // The recurring bug (#90/#91/#128/#129/#135): gating an interactive path on credentials it
  // structurally does not have sends the user to type a solution name they shouldn't have to know.
  it("does not require a client id or secret under interactive", () => {
    expect(canListSolutions({ authType: oauth, organisationUrl: "https://org.crm.dynamics.com", applicationId: undefined, clientSecret: undefined })).toBe(true);
  });

  it("requires both halves of the credential for a service principal", () => {
    const url = "https://org.crm.dynamics.com";
    expect(canListSolutions({ authType: clientSecret, organisationUrl: url, applicationId: "app", clientSecret: "s3cr3t" })).toBe(true);
    expect(canListSolutions({ authType: clientSecret, organisationUrl: url, applicationId: "app" })).toBe(false);
    expect(canListSolutions({ authType: clientSecret, organisationUrl: url, clientSecret: "s3cr3t" })).toBe(false);
  });

  it("cannot list anything without a URL, under either auth type", () => {
    expect(canListSolutions({ authType: oauth })).toBe(false);
    expect(canListSolutions({ authType: clientSecret, applicationId: "app", clientSecret: "s3cr3t" })).toBe(false);
    expect(canListSolutions({ authType: oauth, organisationUrl: "" })).toBe(false);
  });
});

describe("stepAfterSolutionPick / needsPrefixPrompt", () => {
  it("is done once a solution was chosen — the pick carries the publisher prefix", () => {
    expect(stepAfterSolutionPick("PowerToolsDev")).toBe("done");
  });

  it("asks for the name when the pick was dismissed", () => {
    expect(stepAfterSolutionPick(undefined)).toBe("manualSolutionName");
    expect(stepAfterSolutionPick("")).toBe("manualSolutionName");
  });

  it("prompts for a prefix only when nothing supplied one", () => {
    expect(needsPrefixPrompt(undefined)).toBe(true);
    expect(needsPrefixPrompt(null)).toBe(true);
    expect(needsPrefixPrompt("")).toBe(true);
    expect(needsPrefixPrompt("dvpt")).toBe(false);
  });
});

describe("buildWizardConnectionString", () => {
  const url = "https://org.crm.dynamics.com";

  it("carries no secret and no tenant for interactive", () => {
    const result = buildWizardConnectionString({ authType: oauth, organisationUrl: url, applicationId: "app-id" });
    expect(result).toBe("AuthType=OAuth;Url=https://org.crm.dynamics.com;ClientId=app-id");
    expect(result).not.toContain("ClientSecret");
    expect(result).not.toContain("TenantID");
  });

  it("omits the client id for interactive when the default public client is used", () => {
    expect(buildWizardConnectionString({ authType: oauth, organisationUrl: url })).toBe("AuthType=OAuth;Url=https://org.crm.dynamics.com");
  });

  it("emits the full credential for a service principal the user chose to save", () => {
    expect(buildWizardConnectionString({ authType: clientSecret, organisationUrl: url, applicationId: "app-id", clientSecret: "s3cr3t", saveCredential: true })).toBe(
      "AuthType=ClientSecret;LoginPrompt=Never;Url=https://org.crm.dynamics.com;ClientId=app-id;ClientSecret=s3cr3t",
    );
  });

  // Previously a string concat: "…Url=<url>;" + the stored "ClientId=…;ClientSecret=…;". Going
  // through the parser is what guarantees exactly one separator however each half is punctuated.
  it("merges credentials recalled from secret storage without gluing segments together", () => {
    const merged = buildWizardConnectionString({ authType: clientSecret, organisationUrl: url, saveCredential: false }, "ClientId=stored-id;ClientSecret=stored-secret;");
    const parts = parseConnectionString(merged);
    expect(parts.url).toBe(url);
    expect(parts.clientId).toBe("stored-id");
    expect(parts.clientSecret).toBe("stored-secret");
    expect(parts.authType).toBe("ClientSecret");
  });

  it("still produces a usable base when secret storage had nothing", () => {
    const parts = parseConnectionString(buildWizardConnectionString({ authType: clientSecret, organisationUrl: url, saveCredential: false }, ""));
    expect(parts.url).toBe(url);
    expect(parts.clientId).toBeUndefined();
  });
});

describe("listSolutionsConnectionString", () => {
  const url = "https://org.crm.dynamics.com";

  // The wizard used to hand-build a second connection string for the mid-wizard solution listing.
  // Two constructions of the same value drift; this pins them to one.
  it("matches the connection string the wizard will persist", () => {
    const credentials = { authType: clientSecret, organisationUrl: url, applicationId: "app-id", clientSecret: "s3cr3t" };
    expect(listSolutionsConnectionString(credentials)).toBe(buildWizardConnectionString({ ...credentials, saveCredential: true }));
  });

  it("works for interactive with no credentials to speak of", () => {
    expect(listSolutionsConnectionString({ authType: oauth, organisationUrl: url })).toBe("AuthType=OAuth;Url=https://org.crm.dynamics.com");
  });
});
