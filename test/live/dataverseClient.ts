import fetch from "node-fetch";
import { LiveEnv } from "../liveEnv";

// A small, independent Dataverse Web API client for live tests. It authenticates
// with the same service principal and is used to VERIFY (and clean up) whatever the
// extension's own code did — so a test both drives the real feature and checks the
// result through a second, independent path.
const API_VERSION = "api/data/v9.2";

export interface WebresourceRecord {
  webresourceid: string;
  name: string;
  displayname: string;
  content: string; // base64
}

export class LiveDataverseClient {
  private token = "";
  constructor(private readonly env: LiveEnv) {}

  async connect(): Promise<void> {
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", this.env.clientId);
    params.append("client_secret", this.env.clientSecret);
    params.append("resource", this.env.url);
    const res = await fetch(`https://login.microsoftonline.com/${this.env.tenantId}/oauth2/token`, {
      method: "post",
      body: params,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data: any = await res.json();
    if (!data?.access_token) {
      const detail = data?.error_description ? String(data.error_description).split("\n")[0] : (data?.error ?? "unknown error");
      throw new Error(`Token request failed: ${detail}`);
    }
    this.token = data.access_token;
  }

  /** The current access token, for handing to extension code under test. */
  get accessToken(): string {
    return this.token;
  }

  private async request(method: string, path: string, body?: unknown) {
    const init = {
      method,
      /* eslint-disable @typescript-eslint/naming-convention */
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
      },
      /* eslint-enable @typescript-eslint/naming-convention */
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    // Retry transient connection resets (write ECONNRESET etc.). The test Dataverse
    // endpoint occasionally drops a connection mid-request; a few quick retries keep the
    // live suite from failing on a network blip rather than a real error.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await fetch(`${this.env.url}/${API_VERSION}/${path}`, init);
      } catch (err) {
        lastErr = err;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async whoAmI(): Promise<{ UserId: string }> {
    const res = await this.request("GET", "WhoAmI");
    if (!res.ok) {
      throw new Error(`WhoAmI failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as { UserId: string };
  }

  /**
   * A usable customization prefix for creating components. Prefers an explicitly
   * configured DVPT_TEST_PUBLISHER_PREFIX, else the Default solution's publisher.
   */
  async getPublisherPrefix(): Promise<string | undefined> {
    if (this.env.publisherPrefix) {
      return this.env.publisherPrefix;
    }
    const res = await this.request("GET", "solutions?$select=uniquename&$filter=uniquename eq 'Default'&$expand=publisherid($select=customizationprefix)");
    if (!res.ok) {
      return undefined;
    }
    const data: any = await res.json();
    return data.value?.[0]?.publisherid?.customizationprefix;
  }

  async findWebresourceByName(name: string): Promise<WebresourceRecord | undefined> {
    const escaped = name.replace(/'/g, "''");
    const res = await this.request("GET", `webresourceset?$select=webresourceid,name,displayname,content&$filter=name eq '${escaped}'`);
    if (!res.ok) {
      throw new Error(`Query webresource failed: ${res.status} ${await res.text()}`);
    }
    const data: any = await res.json();
    return data.value?.[0];
  }

  async deleteWebresource(id: string): Promise<void> {
    const res = await this.request("DELETE", `webresourceset(${id})`);
    if (!res.ok && res.status !== 404) {
      throw new Error(`Delete webresource failed: ${res.status} ${await res.text()}`);
    }
  }

  /** POST a record and return its GUID (parsed from the OData-EntityId header). */
  private async post(path: string, body: unknown): Promise<string> {
    const res = await this.request("POST", path, body);
    if (!res.ok) {
      throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
    }
    const entityId = res.headers.get("OData-EntityId") ?? "";
    return entityId.match(/\(([^)]+)\)/)?.[1] ?? "";
  }

  async findPublisherByPrefix(prefix: string): Promise<{ publisherid: string; uniquename: string } | undefined> {
    const res = await this.request("GET", `publishers?$select=publisherid,uniquename&$filter=customizationprefix eq '${prefix}'`);
    if (!res.ok) {
      throw new Error(`Query publisher failed: ${res.status} ${await res.text()}`);
    }
    return ((await res.json()) as any).value?.[0];
  }

  async findSolutionByUniqueName(uniqueName: string): Promise<{ solutionid: string; uniquename: string } | undefined> {
    const res = await this.request("GET", `solutions?$select=solutionid,uniquename&$filter=uniquename eq '${uniqueName}'`);
    if (!res.ok) {
      throw new Error(`Query solution failed: ${res.status} ${await res.text()}`);
    }
    return ((await res.json()) as any).value?.[0];
  }

  /**
   * Ensure a dedicated publisher + unmanaged solution exist (idempotent). Returns the
   * solution's unique name and id. New components added to this solution are easy to
   * find in the maker portal instead of getting lost in the Default unmanaged layer.
   */
  async ensureTestSolution(opts: {
    solutionUniqueName: string;
    solutionFriendlyName: string;
    publisherUniqueName: string;
    publisherFriendlyName: string;
    prefix: string;
    optionValuePrefix: number;
  }): Promise<{ uniqueName: string; solutionId: string }> {
    let publisher = await this.findPublisherByPrefix(opts.prefix);
    let publisherId = publisher?.publisherid;
    if (!publisherId) {
      publisherId = await this.post("publishers", {
        uniquename: opts.publisherUniqueName,
        friendlyname: opts.publisherFriendlyName,
        customizationprefix: opts.prefix,
        customizationoptionvalueprefix: opts.optionValuePrefix,
      });
    }

    const existing = await this.findSolutionByUniqueName(opts.solutionUniqueName);
    if (existing) {
      return { uniqueName: existing.uniquename, solutionId: existing.solutionid };
    }

    const solutionId = await this.post("solutions", {
      uniquename: opts.solutionUniqueName,
      friendlyname: opts.solutionFriendlyName,
      version: "1.0.0.0",
      // eslint-disable-next-line @typescript-eslint/naming-convention
      "publisherid@odata.bind": `/publishers(${publisherId})`,
    });
    return { uniqueName: opts.solutionUniqueName, solutionId };
  }

  /** The id of a table's main form (type 2), for form-event tests. */
  async findMainFormId(entityLogicalName: string): Promise<string | undefined> {
    const res = await this.request("GET", `systemforms?$select=formid,name&$filter=objecttypecode eq '${entityLogicalName}' and type eq 2`);
    if (!res.ok) {
      throw new Error(`Query systemforms failed: ${res.status} ${await res.text()}`);
    }
    return ((await res.json()) as any).value?.[0]?.formid;
  }

  /** Get a form's raw formxml. */
  async getFormXml(formId: string): Promise<string> {
    const res = await this.request("GET", `systemforms(${formId})?$select=formxml`);
    if (!res.ok) {
      throw new Error(`Get formxml failed: ${res.status} ${await res.text()}`);
    }
    return ((await res.json()) as any).formxml ?? "";
  }

  /** Find a plugin package by its unique name. */
  async findPluginPackageByUniqueName(uniqueName: string): Promise<{ pluginpackageid: string; uniquename: string } | undefined> {
    const escaped = uniqueName.replace(/'/g, "''");
    const res = await this.request("GET", `pluginpackages?$select=pluginpackageid,uniquename&$filter=uniquename eq '${escaped}'`);
    if (!res.ok) {
      throw new Error(`Query pluginpackage failed: ${res.status} ${await res.text()}`);
    }
    return ((await res.json()) as any).value?.[0];
  }

  /** Get a plugin package by id (to verify a push landed). */
  async getPluginPackageById(id: string): Promise<{ pluginpackageid: string; uniquename: string } | undefined> {
    const res = await this.request("GET", `pluginpackages(${id})?$select=pluginpackageid,uniquename`);
    if (res.status === 404) {
      return undefined;
    }
    if (!res.ok) {
      throw new Error(`Get pluginpackage failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as any;
  }

  /** Delete a plugin package (and its extracted assemblies) to clean up after a test. */
  async deletePluginPackage(id: string): Promise<void> {
    const res = await this.request("DELETE", `pluginpackages(${id})`);
    if (!res.ok && res.status !== 404) {
      throw new Error(`Delete pluginpackage failed: ${res.status} ${await res.text()}`);
    }
  }

  /** Publish all customizations (so newly-created webresources become referenceable). */
  async publishAll(): Promise<void> {
    const res = await this.request("POST", "PublishAllXml");
    if (!res.ok) {
      throw new Error(`PublishAllXml failed: ${res.status} ${await res.text()}`);
    }
  }

  /** Overwrite a form's formxml (used to restore a form after a test). */
  async setFormXml(formId: string, formxml: string): Promise<void> {
    const res = await this.request("PATCH", `systemforms(${formId})`, { formxml });
    if (!res.ok) {
      throw new Error(`Set formxml failed: ${res.status} ${await res.text()}`);
    }
  }

  /** True if the given component (by objectid) is a member of the solution. */
  async isComponentInSolution(solutionId: string, objectId: string): Promise<boolean> {
    const res = await this.request("GET", `solutioncomponents?$select=solutioncomponentid&$filter=_solutionid_value eq ${solutionId} and objectid eq ${objectId}`);
    if (!res.ok) {
      throw new Error(`Query solution components failed: ${res.status} ${await res.text()}`);
    }
    return (((await res.json()) as any).value?.length ?? 0) > 0;
  }
}
