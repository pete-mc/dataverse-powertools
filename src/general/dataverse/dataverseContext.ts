import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";
import { parseConnectionString, normalizeOrganizationUrl } from "../connectionString";

export class DataverseContext {
  public authorizationToken: string = "";
  public tenantId: string = "";
  public organizationUrl: string = "";
  private tokenExpires: Date = new Date();
  private tokenExpiresIn: number = 0;
  private tokenExpiresInBuffer: number = 60;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private context: DataversePowerToolsContext;
  constructor(context: DataversePowerToolsContext) {
    this.context = context;
    this.tenantId = context.projectSettings.tenantId || "";
  }

  public async initialize(): Promise<boolean> {
    if (this.context.connectionString !== "") {
      return await this.acquireToken();
    }
    return false;
  }

  get isValid(): boolean {
    return this.authorizationToken !== "" && this.tokenExpires > new Date();
  }

  async getAuthorizationToken(): Promise<string> {
    if (!this.isValid) {
      await this.acquireToken();
    }
    return this.authorizationToken;
  }

  private scheduleAutoRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    // Refresh ahead of expiry; never schedule a non-positive/too-tight delay.
    const delayMs = Math.max((this.tokenExpiresIn - this.tokenExpiresInBuffer * 2) * 1000, 30000);
    this.refreshTimer = setTimeout(() => {
      void this.acquireToken();
    }, delayMs);
  }

  /**
   * Acquire (or re-acquire) an access token via the OAuth client-credentials grant.
   * That grant does not issue refresh tokens, so "refreshing" is just re-acquiring.
   * The previous code tried a refresh_token grant that always failed, so auto-refresh
   * silently died and calls started 401ing once the first token expired.
   */
  private async acquireToken(): Promise<boolean> {
    try {
      const parts = parseConnectionString(this.context.connectionString);
      const organizationUrl = normalizeOrganizationUrl(parts.url);
      const tokenUrl = "https://login.microsoftonline.com/" + this.tenantId + "/oauth2/token";
      const params = new URLSearchParams();
      params.append("grant_type", "client_credentials");
      params.append("client_id", parts.clientId ?? "");
      params.append("client_secret", parts.clientSecret ?? "");
      params.append("resource", organizationUrl);
      const tokenResponse = await fetch(tokenUrl, {
        method: "post",
        body: params,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const data: any = await tokenResponse.json();
      if (data === null || data["access_token"] === undefined || data["access_token"] === null) {
        this.setDisconnected(data);
        return false;
      }
      this.authorizationToken = data["access_token"];
      this.tokenExpiresIn = Number(data["expires_in"]) || 0;
      this.tokenExpires = new Date();
      this.tokenExpires.setSeconds(this.tokenExpires.getSeconds() + this.tokenExpiresIn - this.tokenExpiresInBuffer);
      this.organizationUrl = organizationUrl;
      this.context.statusBar.text = organizationUrl;
      this.context.statusBar.show();
      this.context.channel.appendLine("Connected to Dataverse");
      this.scheduleAutoRefresh();
      return true;
    } catch (e: any) {
      this.context.channel.appendLine("Error getting authorization token");
      this.context.channel.appendLine(JSON.stringify(e));
      this.setDisconnected();
      return false;
    }
  }

  private setDisconnected(data?: unknown): void {
    this.context.statusBar.text = "Dataverse Not Connected";
    this.context.statusBar.show();
    this.context.channel.appendLine("Error refreshing authorization token");
    if (data !== undefined) {
      this.context.channel.appendLine(JSON.stringify(data));
    }
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
      if (!response.ok) {
        const responseText = await response.text();
        this.context.channel.appendLine(`Failed to publish customizations: ${response.status} ${responseText}`);
      }
    } catch (e: any) {
      this.context.channel.appendLine(`Error publishing customizations: ${e?.message || JSON.stringify(e)}`);
    }
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
      if (!response.ok) {
        const responseText = await response.text();
        this.context.channel.appendLine(`Failed to publish customization: ${response.status} ${responseText}`);
      }
    } catch (e: any) {
      this.context.channel.appendLine(`Error publishing customization: ${e?.message || JSON.stringify(e)}`);
    }
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
