import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";

export class DataverseContext {
  public authorizationToken: string = "";
  public tenantId: string = "";
  public organizationUrl: string = "";
  private refreshToken: string = "";
  private tokenExpires: Date = new Date();
  private tokenExpiresIn: number = 0;
  private tokenExpiresInBuffer: number = 60;
  private context: DataversePowerToolsContext;
  constructor(context: DataversePowerToolsContext) {
    this.context = context;
    this.tenantId = context.projectSettings.tenantId || "";
  }
  public async initialize(): Promise<void> {
    if (this.context.connectionString !== "") {
      await this.refreshAuthorizationToken();
    }
  }

  private async autoRefreshToken(): Promise<void> {
    setTimeout(async () => {
      if (await this.refreshAuthorizationToken()) {
        this.autoRefreshToken();
      }
    }, this.tokenExpiresIn * 1000 - this.tokenExpiresInBuffer * 1000 * 2);
  }

  get isValid(): boolean {
    if (this.authorizationToken === "" || this.tokenExpires < new Date()) {
      return false;
    }
    return true;
  }

  async getAuthorizationToken(): Promise<string> {
    if (this.authorizationToken === "" || this.tokenExpires < new Date()) {
      await this.refreshAuthorizationToken();
    }
    return this.authorizationToken;
  }

  private async getInitialToken(): Promise<boolean> {
    try {
      const tokenUrl = "https://login.microsoftonline.com/" + this.tenantId + "/oauth2/token";
      const params = new URLSearchParams();
      params.append("grant_type", "client_credentials");
      params.append("client_id", this.context.connectionString.split(";")[3].replace("ClientId=", ""));
      params.append("client_secret", this.context.connectionString.split(";")[4].replace("ClientSecret=", ""));
      params.append("resource", this.context.connectionString.split(";")[2].replace("Url=", ""));
      const tokenResponse = await fetch(tokenUrl, {
        method: "post",
        body: params,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const data: any = await tokenResponse.json();
      if (data === null || data["access_token"] === undefined || data["access_token"] === null) {
        this.context.statusBar.text = "Dataverse Not Connected";
        this.context.statusBar.tooltip = "Dataverse Not Connected";
        this.context.statusBar.show();
        return false;
      }
      this.authorizationToken = data["access_token"];
      this.refreshToken = data["refresh_token"];
      this.tokenExpiresIn = data["expires_in"];
      this.tokenExpires = new Date();
      this.tokenExpires.setSeconds(this.tokenExpires.getSeconds() + this.tokenExpiresIn);
      this.organizationUrl = this.context.connectionString.split(";")[2].replace("Url=", "");
      this.autoRefreshToken();
      const splitUri = this.context.connectionString.split(";");
      this.context.statusBar.text = splitUri[2].replace("Url=", "");
      this.context.statusBar.show();
      this.context.channel.appendLine("Connected to Dataverse");
      return true;
    } catch (error) {
      this.context.statusBar.text = "Dataverse Not Connected";
      this.context.statusBar.tooltip = "Dataverse Not Connected";
      this.context.statusBar.show();
      return false;
    }
  }

  private async refreshAuthorizationToken(): Promise<boolean> {
    if (this.refreshToken === "") {
      return await this.getInitialToken();
    }
    try {
      const tokenUrl = "https://login.microsoftonline.com/" + this.tenantId + "/oauth2/token";
      const params = new URLSearchParams();
      params.append("grant_type", "refresh_token");
      params.append("client_id", this.context.connectionString.split(";")[3].replace("ClientId=", ""));
      params.append("client_secret", this.context.connectionString.split(";")[4].replace("ClientSecret=", ""));
      params.append("resource", this.context.connectionString.split(";")[2].replace("Url=", ""));
      params.append("refresh_token", this.refreshToken);
      const tokenResponse = await fetch(tokenUrl, {
        method: "post",
        body: params,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const data: any = await tokenResponse.json();
      if (data === null || data["access_token"] === undefined || data["access_token"] === null) {
        this.context.statusBar.text = "Dataverse Not Connected";
        this.context.statusBar.show();
        this.context.channel.appendLine("Error refreshing authorization token");
        this.context.channel.appendLine(data);
        return false;
      }
      this.authorizationToken = data["access_token"];
      this.refreshToken = data["refresh_token"];
      this.tokenExpiresIn = data["expires_in"];
      this.tokenExpires = new Date();
      this.tokenExpires.setSeconds(this.tokenExpires.getSeconds() + this.tokenExpiresIn - this.tokenExpiresInBuffer);
      const splitUri = this.context.connectionString.split(";");
      this.organizationUrl = this.context.connectionString.split(";")[2].replace("Url=", "");
      this.context.statusBar.text = splitUri[2].replace("Url=", "");
      this.context.statusBar.show();
      this.context.channel.appendLine("Connected to Dataverse");
    } catch (e: any) {
      this.context.channel.appendLine("Error refreshing authorization token");
      this.context.channel.appendLine(e);
      this.context.statusBar.text = "Dataverse Not Connected";
      this.context.statusBar.show();
      return false;
    }
    this.autoRefreshToken();
    return true;
  }

  public async publishAllCustomisations(): Promise<void> {
    if (!this.tenantId || !this.organizationUrl || !this.context.connectionString || !this.isValid) {
      return;
    }
    /* eslint-disable @typescript-eslint/naming-convention */
    const options: Options = {
      method: "POST",
      headers: {
        Authorization: "Bearer " + (await this.getAuthorizationToken()),
        "Content-Type": "application/json",
      },
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    try {
      const url = this.organizationUrl + "/api/data/v9.1/PublishAllXml";
      const response = await fetch(url, options);
      const data: any = await response.json();
      if (data === null) {
        return;
      }
    } catch {}
  }

  /**
   * ParameterXml to pass to dataverse. See: https://learn.microsoft.com/en-us/dotnet/api/microsoft.crm.sdk.messages.publishxmlrequest.parameterxml?view=dataverse-sdk-latest
   * @member {string} customisationXml#publishSingleCustomisation
   */
  public async publishSingleCustomisation(parameterXml: string): Promise<void> {
    if (!this.tenantId || !this.organizationUrl || !this.context.connectionString || !this.isValid) {
      return;
    }
    /* eslint-disable @typescript-eslint/naming-convention */
    const options: Options = {
      method: "POST",
      body: JSON.stringify({ ParameterXml: parameterXml }),
      headers: {
        Authorization: "Bearer " + (await this.getAuthorizationToken()),
        "Content-Type": "application/json",
      },
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    try {
      const url = this.organizationUrl + "/api/data/v9.1/PublishXml";
      const response = await fetch(url, options);
      const data: any = await response.json();
      if (data === null) {
        return;
      }
    } catch {}
  }
}

export interface Options {
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
