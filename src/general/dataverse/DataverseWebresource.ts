import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";
import { Options } from "./dataverseContext";

export class DataverseWebresource {
  id: string | undefined;
  name: string;
  context: DataversePowerToolsContext;

  constructor(name: string, context: DataversePowerToolsContext) {
    this.name = name;
    this.context = context;
  }

  public async load(): Promise<void> {
    const organisationUrl = this.context.dataverse.organizationUrl;
    if (!organisationUrl || !this.context.dataverse.isValid) {
      this.context.channel.appendLine("Could not connect to dataverse.");
      return;
    }

    const escapedName = this.name.replace(/'/g, "''");
    const url = `${organisationUrl}/api/data/v9.1/webresourceset?$select=webresourceid,name&$filter=name eq '${escapedName}'`;

    /* eslint-disable @typescript-eslint/naming-convention */
    const options = {
      method: "GET",
      headers: {
        Authorization: `Bearer ${await this.context.dataverse.getAuthorizationToken()}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    } as Options;
    /* eslint-enable @typescript-eslint/naming-convention */

    const response = await fetch(url, options);
    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Failed to lookup webresource ${this.name}: ${responseText}`);
    }

    const data = (await response.json()) as { value?: Array<{ webresourceid: string }> };
    this.id = data.value && data.value.length > 0 ? data.value[0].webresourceid : undefined;
  }

  public async upsert(contentBase64: string, webresourceType: number, displayName?: string): Promise<void> {
    const organisationUrl = this.context.dataverse.organizationUrl;
    if (!organisationUrl || !this.context.dataverse.isValid) {
      this.context.channel.appendLine("Could not connect to dataverse.");
      return;
    }

    await this.load();

    const body = {
      name: this.name,
      displayname: displayName ?? this.name,
      webresourcetype: webresourceType,
      content: contentBase64,
    };

    /* eslint-disable @typescript-eslint/naming-convention */
    const options = {
      method: this.id ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${await this.context.dataverse.getAuthorizationToken()}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    } as Options;
    /* eslint-enable @typescript-eslint/naming-convention */

    const url = this.id ? `${organisationUrl}/api/data/v9.1/webresourceset(${this.id})` : `${organisationUrl}/api/data/v9.1/webresourceset`;
    const response = await fetch(url, options);

    if (!response.ok) {
      const responseText = await response.text();
      const action = this.id ? "update" : "create";
      throw new Error(`Failed to ${action} webresource ${this.name}: ${responseText}`);
    }
  }

  public async addToSolution(solutionUniqueName: string): Promise<void> {
    if (!solutionUniqueName) {
      return;
    }

    const organisationUrl = this.context.dataverse.organizationUrl;
    if (!organisationUrl || !this.context.dataverse.isValid) {
      this.context.channel.appendLine("Could not connect to dataverse.");
      return;
    }

    if (!this.id) {
      await this.load();
    }

    if (!this.id) {
      this.context.channel.appendLine(`Unable to resolve webresource id for ${this.name}; skipping solution association.`);
      return;
    }

    /* eslint-disable @typescript-eslint/naming-convention */
    const options = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.context.dataverse.getAuthorizationToken()}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ComponentId: this.id,
        ComponentType: 61,
        SolutionUniqueName: solutionUniqueName,
        AddRequiredComponents: false,
        DoNotIncludeSubcomponents: false,
      }),
    } as Options;
    /* eslint-enable @typescript-eslint/naming-convention */

    const response = await fetch(`${organisationUrl}/api/data/v9.1/AddSolutionComponent`, options);
    if (response.ok) {
      return;
    }

    const responseText = await response.text();
    const alreadyInSolution = responseText.toLowerCase().includes("already") && responseText.toLowerCase().includes("solution");
    if (alreadyInSolution) {
      return;
    }

    throw new Error(`Failed to add webresource ${this.name} to solution ${solutionUniqueName}: ${responseText}`);
  }

  public static mapWebresourceType(extension: string): number | undefined {
    switch (extension) {
      case ".htm":
      case ".html":
        return 1;
      case ".css":
        return 2;
      case ".js":
        return 3;
      case ".xml":
        return 4;
      case ".png":
        return 5;
      case ".jpg":
      case ".jpeg":
        return 6;
      case ".gif":
        return 7;
      case ".xap":
        return 8;
      case ".xsl":
        return 9;
      case ".ico":
        return 10;
      case ".svg":
        return 11;
      case ".resx":
        return 12;
      default:
        return undefined;
    }
  }
}
