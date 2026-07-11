import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { Options } from "./dataverseContext";
import { dataverseApiUrl, logDataverseHttpError, logDataverseError } from "./webApi";
import { canCallDataverseApi } from "./connectionReady";

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
    isArray: (_name: string, jPathOrMatcher: unknown, _isLeafNode: boolean, _isAttribute: boolean) => {
      const alwaysArray = ["form.formLibraries.Library", "form.events.event", "form.events.event.Handlers.Handler"]; //add any node here that you want to force to be an array.
      const jpath = typeof jPathOrMatcher === "string" ? jPathOrMatcher : "";
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

  // Returns true only if the form was loaded. Callers must not proceed on false — a failed load
  // leaves `this.form` undefined, and it means the whole registration should be reported as failed
  // rather than silently succeeding (#90).
  public async getFormData(): Promise<boolean> {
    // Gate on the live connection + org URL only — NOT projectSettings.tenantId, which is a
    // service-principal concept that interactive (OAuth) sign-in never populates. Requiring it
    // broke "Register Form Events" under interactive auth with "Could not connect to dataverse."
    // even though the connection was valid (the deploy path already guards this way).
    const organisationUrl = this.context.dataverse?.organizationUrl;
    if (!canCallDataverseApi({ organizationUrl: organisationUrl, isValid: this.context.dataverse?.isValid })) {
      this.context.channel.appendLine("Could not connect to dataverse.");
      return false;
    }
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
      const url = dataverseApiUrl(organisationUrl, `systemforms(${this.id})?$select=formxml`);
      const response = await fetch(url, options);
      if (response.ok === false) {
        await logDataverseHttpError(this.context.channel, `load form '${this.id}'`, response);
        return false;
      }
      const data: any = await response.json();
      if (data === null) {
        return false;
      }
      this.form = await new XMLParser(this.parsingOptions).parse(data.formxml);
      return true;
    } catch (e) {
      logDataverseError(this.context.channel, `load form '${this.id}'`, e);
      return false;
    }
  }

  // Returns true only if the form was saved. A false result (e.g. a 400 because the referenced web
  // resource isn't deployed yet) must surface to the user rather than looking like success (#90).
  public async saveForm(): Promise<boolean> {
    // Same connection gate as getFormData — no tenantId requirement (see the note there).
    const organisationUrl = this.context.dataverse?.organizationUrl;
    if (!canCallDataverseApi({ organizationUrl: organisationUrl, isValid: this.context.dataverse?.isValid })) {
      this.context.channel.appendLine("Could not connect to dataverse.");
      return false;
    }
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
      const url = dataverseApiUrl(organisationUrl, `systemforms(${this.id})`);
      const response = await fetch(url, options);
      if (!response.ok) {
        await logDataverseHttpError(this.context.channel, `save form '${this.id}'`, response);
        return false;
      }
      this.context.channel.appendLine(`Saved Form: ${this.id}`);
      return true;
    } catch (e) {
      logDataverseError(this.context.channel, `save form '${this.id}'`, e);
      return false;
    }
  }
}
