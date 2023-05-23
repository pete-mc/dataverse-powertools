import fetch from "node-fetch";

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

export async function getSolutions(organisationUrl: string, tenantId: string, applicationId: string, clientSecret: string): Promise<DataverseSolution[] | undefined> {
  const options = await getDavaverseFetchOptions(organisationUrl, tenantId, applicationId, clientSecret, "GET");
  if (options === undefined) {
    return undefined;
  }
  try {
    const url = organisationUrl + "/api/data/v9.1/solutions?$select=friendlyname,uniquename,solutionid,publisherid&$filter=ismanaged%20eq%20false&$expand=publisherid($select=friendlyname,customizationprefix,publisherid)";
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
  headers: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Authorization: string;
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
