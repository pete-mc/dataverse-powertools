// @vitest-environment jsdom
//
// Webview DOM test for the results grid's browser script (#238). This renderer is the one that puts
// DATA FROM THE ENVIRONMENT on screen, so the important assertions here are that it renders values as
// text rather than markup, and that it states the things that silently change what a run means — the
// identity the query ran as, and the row cap.
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { flattenResults } from "./results";

const SCRIPT = fs.readFileSync(path.resolve(__dirname, "../../media/queryResults.js"), "utf8");

interface PostedMessage {
  type: string;
  [key: string]: unknown;
}

/** The element ids resultsPanel.ts's HTML shell provides. */
const SHELL = `
  <header id="summary"></header>
  <div id="error" hidden></div>
  <div id="grid"></div>
  <button id="copyCsv"></button>
  <button id="copyJson"></button>
  <button id="copyXml"></button>
`;

function loadResults(): { posted: PostedMessage[] } {
  const posted: PostedMessage[] = [];
  (globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: (message: PostedMessage) => posted.push(message),
    getState: () => undefined,
    setState: () => undefined,
  });
  document.body.innerHTML = SHELL;
  new Function(SCRIPT)();
  return { posted };
}

/** Post the payload shape resultsPanel.ts sends (cells only, raw records stripped). */
function postResults(payload: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data: { type: "results", payload } }));
}

function payloadFrom(response: unknown, context: Record<string, unknown> = { organizationUrl: "https://org.crm.dynamics.com", identity: "Ada Lovelace", rowCap: 50 }): unknown {
  const table = flattenResults(response);
  return {
    columns: table.columns,
    rows: table.rows.map((row) => row.cells),
    totalRecordCount: table.totalRecordCount,
    moreRecords: table.moreRecords,
    context,
    title: "Plugin.cs",
  };
}

/* eslint-disable @typescript-eslint/naming-convention -- Web API key names. */
const RESPONSE = {
  "@Microsoft.Dynamics.CRM.totalrecordcount": 120,
  "@Microsoft.Dynamics.CRM.morerecords": true,
  value: [
    { title: "Broken widget", statecode: 0, "statecode@OData.Community.Display.V1.FormattedValue": "Active" },
    { title: "Late delivery", statecode: 1, "statecode@OData.Community.Display.V1.FormattedValue": "Resolved" },
  ],
};
/* eslint-enable @typescript-eslint/naming-convention */

describe("queryResults.js (webview DOM)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a header row and one row per record, using formatted values", () => {
    loadResults();
    postResults(payloadFrom(RESPONSE));
    expect([...document.querySelectorAll("#grid th")].map((th) => th.textContent)).toEqual(["title", "statecode"]);
    const rows = [...document.querySelectorAll("#grid tbody tr")];
    expect(rows).toHaveLength(2);
    expect([...rows[0].querySelectorAll("td")].map((td) => td.textContent)).toEqual(["Broken widget", "Active"]);
    expect([...rows[1].querySelectorAll("td")].map((td) => td.textContent)).toEqual(["Late delivery", "Resolved"]);
  });

  it("states the row count, the total, and that more are available", () => {
    loadResults();
    postResults(payloadFrom(RESPONSE));
    const summary = document.getElementById("summary")?.textContent ?? "";
    expect(summary).toContain("2 rows");
    expect(summary).toContain("of 120 matching");
    expect(summary).toContain("more available");
  });

  it("states the environment and identity the query ran as", () => {
    // The run happens as the CONNECTED identity, not as whoever will run the plugin — row-level
    // security and eq-userid resolve differently at runtime, so this has to be on screen.
    loadResults();
    postResults(payloadFrom(RESPONSE));
    const ranAs = document.querySelector("#summary .ran-as")?.textContent ?? "";
    expect(ranAs).toContain("https://org.crm.dynamics.com");
    expect(ranAs).toContain("as Ada Lovelace");
  });

  it("says when the rows were capped for a test run", () => {
    loadResults();
    postResults(payloadFrom(RESPONSE));
    expect(document.querySelector("#summary .capped")?.textContent).toContain("capped at 50");
  });

  it("omits the cap note when the query set its own paging", () => {
    loadResults();
    postResults(payloadFrom(RESPONSE, { organizationUrl: "https://org.crm.dynamics.com" }));
    expect(document.querySelector("#summary .capped")).toBeNull();
  });

  it("says so plainly when nothing matched", () => {
    loadResults();
    postResults(payloadFrom({ value: [] }));
    expect(document.querySelector("#grid .no-rows")?.textContent).toBe("No rows matched.");
    expect(document.querySelector("#grid table")).toBeNull();
  });

  it("marks an empty cell rather than leaving it indistinguishable", () => {
    loadResults();
    postResults(payloadFrom({ value: [{ title: "x", ticketnumber: null }] }));
    const cells = [...document.querySelectorAll("#grid tbody td")];
    expect(cells[1].className).toBe("empty-value");
    expect(cells[1].textContent).toBe("");
  });

  it("leaves a column blank on a row that doesn't have it", () => {
    loadResults();
    postResults(payloadFrom({ value: [{ title: "a" }, { title: "b", ticketnumber: "CAS-01" }] }));
    const rows = [...document.querySelectorAll("#grid tbody tr")];
    expect([...rows[0].querySelectorAll("td")].map((td) => td.textContent)).toEqual(["a", ""]);
    expect([...rows[1].querySelectorAll("td")].map((td) => td.textContent)).toEqual(["b", "CAS-01"]);
  });

  it("renders a cell containing markup as TEXT — org data is untrusted", () => {
    loadResults();
    postResults(payloadFrom({ value: [{ name: "<img src=x onerror=alert(1)>" }] }));
    expect(document.querySelector("#grid img")).toBeNull();
    expect(document.querySelector("#grid tbody td")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("renders a column NAME containing markup as text too", () => {
    loadResults();
    // A column name is org-controlled too (an alias in the query, a schema name).
    // eslint-disable-next-line @typescript-eslint/naming-convention -- deliberately hostile key.
    postResults(payloadFrom({ value: [{ "<script>x</script>": "v" }] }));
    expect(document.querySelector("#grid script")).toBeNull();
    expect(document.querySelector("#grid th")?.textContent).toBe("<script>x</script>");
  });

  it("shows a Dataverse error in place of the grid, and clears it on the next run", () => {
    loadResults();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "error", error: "'name' is not a valid column.", title: "Plugin.cs" } }));
    const error = document.getElementById("error") as HTMLElement;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain("not a valid column");
    expect(document.querySelector("#grid table")).toBeNull();

    postResults(payloadFrom(RESPONSE));
    expect(error.hidden).toBe(true);
    expect(document.querySelectorAll("#grid tbody tr")).toHaveLength(2);
  });

  it("posts the copy intents rather than handling data itself", () => {
    const { posted } = loadResults();
    postResults(payloadFrom(RESPONSE));
    for (const id of ["copyCsv", "copyJson", "copyXml"]) {
      (document.getElementById(id) as HTMLElement).click();
    }
    expect(posted).toEqual([{ type: "copyCsv" }, { type: "copyJson" }, { type: "copyXml" }]);
  });
});
