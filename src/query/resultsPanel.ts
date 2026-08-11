// The query results view (#238) — one webview panel, reused by both entry points (the generator's Run
// button and the CodeLens ▶ Run), so there is a single renderer to keep correct.
//
// Every cell is org data, i.e. untrusted input, so the grid is built with textContent in the
// webview and NOTHING here interpolates a value into HTML. The strict CSP mirrors the actions panel.

import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { ResultTable, resultsToCsv } from "./results";
import { RunContext } from "./runQuery";

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

export interface ResultsPayload {
  table: ResultTable;
  context: RunContext;
  /** The FetchXML that actually ran, parameters substituted. */
  xml: string;
  title: string;
}

let panel: vscode.WebviewPanel | undefined;
let latest: ResultsPayload | undefined;

/** Show (or refresh) the results view beside the editor. */
export function showResults(context: DataversePowerToolsContext, payload: ResultsPayload): void {
  latest = payload;
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      "dataversePowerToolsQueryResults",
      "FetchXML results",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.vscode.extensionUri, "media")],
      },
    );
    panel.onDidDispose(() => {
      panel = undefined;
    });
    panel.webview.onDidReceiveMessage(async (message: { type?: string }) => {
      // The webview can only ask for a copy of data the host already holds — it never names a path,
      // a command or a URL.
      if (!latest) {
        return;
      }
      if (message?.type === "copyCsv") {
        await vscode.env.clipboard.writeText(resultsToCsv(latest.table));
        vscode.window.showInformationMessage("Results copied as CSV.");
      } else if (message?.type === "copyJson") {
        await vscode.env.clipboard.writeText(
          JSON.stringify(
            latest.table.rows.map((row) => row.raw),
            undefined,
            2,
          ),
        );
        vscode.window.showInformationMessage("Results copied as JSON.");
      } else if (message?.type === "copyXml") {
        await vscode.env.clipboard.writeText(latest.xml);
        vscode.window.showInformationMessage("FetchXML copied.");
      }
    });
    panel.webview.html = html(panel.webview, context);
  }

  panel.title = `FetchXML results — ${payload.title}`;
  void panel.webview.postMessage({ type: "results", payload: serializable(payload) });
  panel.reveal(vscode.ViewColumn.Beside, true);
}

/** Show an error in the same place the rows would have appeared. */
export function showResultsError(context: DataversePowerToolsContext, title: string, error: string): void {
  showResults(context, { table: { columns: [], rows: [] }, context: { organizationUrl: "" }, xml: "", title });
  void panel?.webview.postMessage({ type: "error", error, title });
}

/** Strip the raw records: they can be large, and the grid only renders the display cells. */
function serializable(payload: ResultsPayload): unknown {
  return {
    columns: payload.table.columns,
    rows: payload.table.rows.map((row) => row.cells),
    totalRecordCount: payload.table.totalRecordCount,
    moreRecords: payload.table.moreRecords,
    context: payload.context,
    title: payload.title,
    xmlLength: payload.xml.length,
  };
}

function html(webview: vscode.Webview, context: DataversePowerToolsContext): string {
  const token = nonce();
  const css = webview.asWebviewUri(vscode.Uri.joinPath(context.vscode.extensionUri, "media", "queryResults.css"));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(context.vscode.extensionUri, "media", "queryResults.js"));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${token}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${css}" rel="stylesheet">
  <title>FetchXML results</title>
</head>
<body>
  <header id="summary" aria-live="polite"></header>
  <div id="error" role="alert" hidden></div>
  <div id="grid" tabindex="0"></div>
  <footer>
    <button id="copyCsv" type="button">Copy as CSV</button>
    <button id="copyJson" type="button">Copy as JSON</button>
    <button id="copyXml" type="button">Copy FetchXML</button>
  </footer>
  <script nonce="${token}" src="${js}"></script>
</body>
</html>`;
}
