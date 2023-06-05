import fetch from "node-fetch";
import DataversePowerToolsContext from "../context";
import { XMLBuilder, XMLParser } from "fast-xml-parser";

async function getDavaverseFetchOptions(organisationUrl: string, tenantId: string, applicationId: string, clientSecret: string, method: string): Promise<Options | undefined> {
  try {
    const tokenUrl = "https://login.microsoftonline.com/" + tenantId + "/oauth2/token";
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", applicationId || "");
    params.append("client_secret", clientSecret || "");
    params.append("resource", organisationUrl || "");

    const tokenRequestBody: any = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      grant_type: "client_credentials",
      // eslint-disable-next-line @typescript-eslint/naming-convention
      client_id: applicationId || "",
      // eslint-disable-next-line @typescript-eslint/naming-convention
      client_secret: clientSecret || "",
      resource: organisationUrl || "",
    };

    let formBody = [];
    for (var property in tokenRequestBody) {
      var encodedKey = encodeURIComponent(property);
      var encodedValue = encodeURIComponent(tokenRequestBody[property]);
      formBody.push(encodedKey + "=" + encodedValue);
    }
    const formBodyString = formBody.join("&");

    const tokenResponse = await fetch(tokenUrl, {
      method: "post",
      body: formBodyString,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const data: any = await tokenResponse.json();
    if (data === null || data["access_token"] === undefined || data["access_token"] === null) {
      return undefined;
    }
    const options = {
      method: method,
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Authorization: "Bearer " + data["access_token"],
      },
    } as Options;
    return options;
  } catch {
    return undefined;
  }
}
async function getDavaverseFetchOptionsFormContext(context: DataversePowerToolsContext, method: string): Promise<Options | undefined> {
  if (!context.projectSettings.tenantId) {
    return undefined;
  }
  return await getDavaverseFetchOptions(
    context.connectionString.split(";")[2].replace("Url=", ""),
    context.projectSettings.tenantId,
    context.connectionString.split(";")[3].replace("ClientId=", ""),
    context.connectionString.split(";")[4].replace("ClientSecret=", ""),
    method,
  );
}

export async function getSolutions(organisationUrl: string, tenantId: string, applicationId: string, clientSecret: string): Promise<DataverseSolution[] | undefined> {
  const options = await getDavaverseFetchOptions(organisationUrl, tenantId, applicationId, clientSecret, "GET");
  if (options === undefined) {
    return undefined;
  }
  try {
    const url =
      organisationUrl +
      "/api/data/v9.1/solutions?$select=friendlyname,uniquename,solutionid,publisherid&$filter=ismanaged%20eq%20false&$expand=publisherid($select=friendlyname,customizationprefix,publisherid)";
    const response = await fetch(url, options);
    const data: any = await response.json();
    if (data === null) {
      return undefined;
    }
    const solutions = data.value.map((record: SolutionResult) => new DataverseSolution(record));
    return solutions;
  } catch {
    return undefined;
  }
}

async function getDataverseTables(organisationUrl: string, tenantId: string, applicationId: string, clientSecret: string): Promise<string[]> {
  const options = await getDavaverseFetchOptions(organisationUrl, tenantId, applicationId, clientSecret, "GET");
  if (options === undefined) {
    return [];
  }
  try {
    const url = organisationUrl + "/api/data/v9.1/EntityDefinitions?$select=LogicalName";
    const response = await fetch(url, options);
    const data: any = await response.json();
    if (data === null) {
      return [];
    }
    const tables = data.value.map((record: any) => record.LogicalName);
    return tables;
  } catch {
    return [];
  }
}

export async function getDataverseTablesFromContext(context: DataversePowerToolsContext): Promise<string[]> {
  if (!context.projectSettings.tenantId) {
    return [];
  }
  return await getDataverseTables(
    context.connectionString.split(";")[2].replace("Url=", ""),
    context.projectSettings.tenantId,
    context.connectionString.split(";")[3].replace("ClientId=", ""),
    context.connectionString.split(";")[4].replace("ClientSecret=", ""),
  );
}

export class DataverseForm {
  id: string;
  displayName: string | undefined;
  context: DataversePowerToolsContext;
  public form: any;
  parsingOptions = {
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    suppressBooleanAttributes: false,
    suppressEmptyNode: true,
    isArray: (_name: unknown, jpath: string, _isLeafNode: unknown, _isAttribute: unknown) => {
      const alwaysArray = ["form.formLibraries.Library", "form.events.event", "form.events.event.Handlers.Handler"]; //add any node here that you want to force to be an array.
      if (alwaysArray.indexOf(jpath) !== -1) {
        return true;
      }
      return false;
    },
  };
  constructor(formid: string, context: DataversePowerToolsContext) {
    this.id = formid;
    this.context = context;
  }

  public async getFormData(): Promise<void> {
    if (!this.context.projectSettings.tenantId) {
      return;
    }
    const organisationUrl = this.context.connectionString.split(";")[2].replace("Url=", "");
    const options = await getDavaverseFetchOptionsFormContext(this.context, "GET");
    if (options === undefined) {
      return;
    }
    try {
      this.context.channel.appendLine(`Loading Form: ${this.id}`);
      const url = organisationUrl + "/api/data/v9.1/systemforms(" + this.id + ")?$select=formxml";
      const response = await fetch(url, options);
      if (response.ok === false) {
        this.context.channel.appendLine(await response.text());
        return;
      }
      const data: any = await response.json();
      if (data === null) {
        return;
      }
      this.form = await new XMLParser(this.parsingOptions).parse(data.formxml);
    } catch (e) {
      this.context.channel.appendLine(JSON.stringify(e));
    }
  }

  public async saveForm(): Promise<void> {
    if (!this.context.projectSettings.tenantId) {
      return;
    }
    const organisationUrl = this.context.connectionString.split(";")[2].replace("Url=", "");
    var options = await getDavaverseFetchOptionsFormContext(this.context, "PATCH");
    if (options === undefined) {
      return;
    }
    try {
      options.headers["Content-Type"] = "application/json";
      options.headers["Accept"] = "application/json";
      const formxml = (await new XMLBuilder(this.parsingOptions).build(this.form)).replace(/&quot;/g, '"');
      options.body = JSON.stringify({ formxml: formxml });
      const url = organisationUrl + "/api/data/v9.1/systemforms(" + this.id + ")";
      const response = await fetch(url, options);
      const data: any = await response.text();
      if (data === null || data === "") {
        this.context.channel.appendLine(`Saved Form: ${this.id}`);
        return;
      }
      this.context.channel.appendLine(data);
    } catch (e) {
      this.context.channel.appendLine(JSON.stringify(e));
    }
  }
}

export async function publishAllCustomisations(context: DataversePowerToolsContext) {
  if (!context.projectSettings.tenantId) {
    return;
  }
  const organisationUrl = context.connectionString.split(";")[2].replace("Url=", "");
  const options = await getDavaverseFetchOptionsFormContext(context, "POST");
  if (options === undefined) {
    return;
  }
  try {
    const url = organisationUrl + "/api/data/v9.1/PublishAllXml";
    const response = await fetch(url, options);
    const data: any = await response.json();
    if (data === null) {
      return;
    }
  } catch {}
}
export class DataverseSolution {
  id: string;
  displayName: string;
  uniqueName: string;
  publisherName: string;
  publisherId: string;
  publisherPrefix: string;
  constructor(record: SolutionResult) {
    this.id = record.solutionid;
    this.displayName = record.friendlyname;
    this.uniqueName = record.uniquename;
    this.publisherName = record.publisherid.friendlyname;
    this.publisherId = record.publisherid.publisherid;
    this.publisherPrefix = record.publisherid.customizationprefix;
  }
}

interface Options {
  method: string;
  body?: any;
  headers: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Authorization: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Accept?: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    "Content-Type"?: string;
  };
}

interface SolutionResult {
  friendlyname: string;
  uniquename: string;
  solutionid: string;
  publisherid: {
    friendlyname: string;
    customizationprefix: string;
    publisherid: string;
  };
}
