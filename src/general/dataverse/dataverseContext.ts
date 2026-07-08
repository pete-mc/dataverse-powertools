import fetch from "node-fetch";
import DataversePowerToolsContext from "../../context";
import { parseConnectionString, normalizeOrganizationUrl } from "../connectionString";
import { parseAuthType, DataverseAuthType } from "./authTypes";
import { acquireClientSecretToken, acquireCertificateToken, acquireInteractiveToken, TokenResult } from "./tokenAcquisition";
import { loadCertificate } from "./certificate";

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
      // First connect: allow an interactive sign-in prompt if the auth type needs one.
      return await this.acquireToken(true);
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

  private certificatePasswordKey(organizationUrl: string): string {
    return `${organizationUrl}::certificatePassword`;
  }

  /**
   * Acquire (or re-acquire) an access token for the connection's auth type:
   *   - ClientSecret / Certificate: client-credentials grant (no refresh token, so
   *     "refreshing" is just re-acquiring). MSAL signs the assertion for certificates.
   *   - OAuth: interactive user sign-in through VS Code's Microsoft auth provider,
   *     which owns caching and silent refresh.
   * `promptIfNeeded` allows an interactive sign-in prompt (first connect only);
   * background refreshes pass false so they stay silent.
   */
  private async acquireToken(promptIfNeeded: boolean = false): Promise<boolean> {
    try {
      const parts = parseConnectionString(this.context.connectionString);
      const organizationUrl = normalizeOrganizationUrl(parts.url);
      const authType = parseAuthType(parts.authType);

      let token: TokenResult | undefined;
      switch (authType) {
        case DataverseAuthType.oauth:
          token = await acquireInteractiveToken(organizationUrl, this.tenantId, parts.clientId, promptIfNeeded);
          break;
        case DataverseAuthType.certificate: {
          if (!parts.certificatePath) {
            this.context.channel.appendLine("Certificate auth is selected but the connection has no CertificatePath.");
            this.setDisconnected();
            return false;
          }
          const passphrase = (await this.context.vscode.secrets.get(this.certificatePasswordKey(organizationUrl))) || undefined;
          const credential = await loadCertificate(parts.certificatePath, passphrase);
          token = await acquireCertificateToken(parts.clientId ?? "", this.tenantId, organizationUrl, credential);
          break;
        }
        case DataverseAuthType.clientSecret:
        default:
          token = await acquireClientSecretToken(parts.clientId ?? "", parts.clientSecret ?? "", this.tenantId, organizationUrl);
          break;
      }

      if (!token || !token.accessToken) {
        this.setDisconnected();
        return false;
      }

      this.authorizationToken = token.accessToken;
      const expiresOn = token.expiresOn ?? new Date(Date.now() + 55 * 60 * 1000);
      this.tokenExpiresIn = Math.max(Math.floor((expiresOn.getTime() - Date.now()) / 1000), 0);
      // Expire a little early (the buffer) so we never hand out an about-to-die token.
      this.tokenExpires = new Date(expiresOn.getTime() - this.tokenExpiresInBuffer * 1000);
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
