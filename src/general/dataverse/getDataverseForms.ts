import fetch from "node-fetch";
import { Options } from "./dataverseContext";
import DataversePowerToolsContext from "../../context";

export async function getDataverseForms(context: DataversePowerToolsContext, entity: string): Promise<DataverseFormRecord[]> {
  if (!context.dataverse.isValid) {
    if (!(await context.dataverse.initialize())) {
      return [];
    }
  }
  /* eslint-disable @typescript-eslint/naming-convention */
  const options = {
    headers: {
      Authorization: "Bearer " + context.dataverse?.authorizationToken,
      "Content-Type": "application/json",
    },
    method: "GET",
  } as Options;
  /* eslint-enable @typescript-eslint/naming-convention */
  if (options === undefined) {
    return [];
  }
  try {
    const url =
      context.dataverse?.organizationUrl +
      `/api/data/v9.2/msdyn_solutioncomponentsummaries?$filter=((msdyn_componenttype%20eq%2060))%20and%20(msdyn_primaryentityname%20eq%20%27${entity}%27)&$select=msdyn_name,msdyn_objectid,msdyn_componenttypename`;
    const response = await fetch(url, options);
    const data: any = await response.json();
    if (data === null) {
      return [];
    }
    const forms = data.value.map((record: any) => {
      return {
        formId: record.msdyn_objectid,
        displayName: record.msdyn_name,
        formType: record.msdyn_componenttypename,
      } as DataverseFormRecord;
    });
    return forms;
  } catch {
    return [];
  }
}

export interface DataverseFormRecord {
  formId: string;
  displayName: string;
  formType: string;
}
