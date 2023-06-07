import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { Options } from "./dataverseContext";

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
    if (!this.context.projectSettings.tenantId || !this.context.dataverse || !this.context.dataverse?.isValid) {
      this.context.channel.appendLine("Could not connect to dataverse.");
      return;
    }
    const organisationUrl = this.context.connectionString.split(";")[2].replace("Url=", "");
    /* eslint-disable @typescript-eslint/naming-convention */
    const options = {
      headers: {
        Authorization: "Bearer " + this.context.dataverse?.authorizationToken,
        "Content-Type": "application/json",
      },
      method: "GET",
    } as Options;
    /* eslint-enable @typescript-eslint/naming-convention */
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
    if (!this.context.projectSettings.tenantId || !this.context.dataverse || !this.context.dataverse?.isValid) {
      this.context.channel.appendLine("Could not connect to dataverse.");
      return;
    }
    const organisationUrl = this.context.connectionString.split(";")[2].replace("Url=", "");
    try {
      /* eslint-disable @typescript-eslint/naming-convention */
      const options = {
        headers: {
          Authorization: "Bearer " + this.context.dataverse?.authorizationToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        method: "PATCH",
      } as Options;
      /* eslint-enable @typescript-eslint/naming-convention */
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
