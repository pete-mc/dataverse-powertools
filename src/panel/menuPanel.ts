import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { buildMenuModel, ALLOWED_EXTERNAL_URLS } from "./menuModel";
import { computePanelState } from "./panelState";
import { projectTypeRegistry } from "../projectTypes/registry";
import { onDebugSessionChanged } from "../webresources/debug/debugWebresources";
import { openScannedRegistration } from "./registrationsScanner";

// Commands the webview may ask the host to run. The webview is our own code
// behind a strict CSP, but treat its messages as untrusted anyway.
const GENERAL_PANEL_COMMANDS = [
  "dataverse-powertools.initialiseProject",
  "dataverse-powertools.addComponent",
  "dataverse-powertools.restoreDependencies",
  "dataverse-powertools.refreshConnection",
  "dataverse-powertools.updateConnectionString",
  "dataverse-powertools.switchEnvironment",
  "dataverse-powertools.recheckRequirements",
  "dataverse-powertools.showLog",
  "workbench.action.openWalkthrough",
];

const allowedCommands = new Set<string>([...GENERAL_PANEL_COMMANDS, ...projectTypeRegistry.flatMap((d) => [...d.commandIds])]);

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

/** The "Actions" side-bar panel (#100): a WebviewView rendering the MenuModel.
 * All content and logic live in the view-model; this class only ships the shell
 * (HTML/CSS/JS from media/) and relays clicks back to commands. */
export class MenuPanelViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dataversePowerToolsMenu";
  private view?: vscode.WebviewView;

  constructor(private readonly context: DataversePowerToolsContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.vscode.extensionUri, "media")],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (message) => this.onMessage(message));
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
      }
    });
    this.refresh();
  }

  /** Recompute the model and push it to the webview (no-op until the view resolves). */
  refresh(): void {
    if (!this.view) {
      return;
    }
    void this.view.webview.postMessage({ type: "model", model: buildMenuModel(computePanelState(this.context)) });
  }

  private async onMessage(message: { type?: string; command?: string; args?: unknown[]; url?: string; index?: number }): Promise<void> {
    switch (message?.type) {
      case "ready":
        this.refresh();
        break;
      case "openRegistration":
        // The webview only sends an index into the host-side scanner cache —
        // it can never name a file path directly.
        if (typeof message.index === "number") {
          await openScannedRegistration(message.index);
        }
        break;
      case "execute":
        if (typeof message.command === "string" && allowedCommands.has(message.command)) {
          this.context.channel.appendLine(`[Panel] ${message.command}`);
          try {
            await vscode.commands.executeCommand(message.command, ...(Array.isArray(message.args) ? message.args : []));
          } catch (err) {
            this.context.channel.appendLine(`[Panel] Command failed: ${message.command}: ${err}`);
          }
        }
        break;
      case "openExternal":
        if (typeof message.url === "string" && ALLOWED_EXTERNAL_URLS.includes(message.url)) {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        break;
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.context.vscode.extensionUri, "media", "menuPanel.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.context.vscode.extensionUri, "media", "menuPanel.js"));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${css}" rel="stylesheet">
  <title>Dataverse PowerTools</title>
</head>
<body>
  <main id="root" aria-live="polite"></main>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

export function registerMenuPanel(context: DataversePowerToolsContext): MenuPanelViewProvider {
  const provider = new MenuPanelViewProvider(context);
  context.vscode.subscriptions.push(vscode.window.registerWebviewViewProvider(MenuPanelViewProvider.viewType, provider));
  context.refreshPanel = () => provider.refresh();
  onDebugSessionChanged(() => provider.refresh());
  return provider;
}
