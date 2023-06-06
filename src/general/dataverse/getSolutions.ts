import fetch from "node-fetch";
import { DataverseContext, Options } from "./dataverseContext";
import DataversePowerToolsContext from "../../context";

export async function getSolutions(context: DataversePowerToolsContext): Promise<DataverseSolution[] | undefined> {
  /* eslint-disable @typescript-eslint/naming-convention */
  if (!context.dataverse) {
    context.dataverse = new DataverseContext(context);
  }
  if (!context.dataverse?.isValid) {
    await context.dataverse?.initialize();
  }
  const options = {
    headers: {
      Authorization: "Bearer " + context.dataverse?.authorizationToken,
      "Content-Type": "application/json",
    },
    method: "GET",
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */
  if (options === undefined) {
    return undefined;
  }
  try {
    const url =
      context.dataverse?.organizationUrl +
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

export interface SolutionResult {
  friendlyname: string;
  uniquename: string;
  solutionid: string;
  publisherid: {
    friendlyname: string;
    customizationprefix: string;
    publisherid: string;
  };
}
