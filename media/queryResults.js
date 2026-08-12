// FetchXML results webview renderer (#238).
//
// Every cell here is data from the environment, i.e. untrusted input. The grid is therefore built
// with createElement/textContent throughout — there is no innerHTML in this file, and none should be
// added.

(function () {
  const vscode = acquireVsCodeApi();

  const els = {
    summary: document.getElementById("summary"),
    error: document.getElementById("error"),
    grid: document.getElementById("grid"),
    copyCsv: document.getElementById("copyCsv"),
    copyJson: document.getElementById("copyJson"),
    copyXml: document.getElementById("copyXml"),
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function renderSummary(payload) {
    els.summary.replaceChildren();

    const rows = payload.rows.length;
    const total = payload.totalRecordCount;
    const count = el("div");
    count.appendChild(el("span", "count", `${rows} ${rows === 1 ? "row" : "rows"}`));
    // Dataverse returns -1 for the total when it did not count (no `returntotalrecordcount`, or the
    // page is the whole result) — "0 rows of -1 matching" is not a fact about anything, so say nothing.
    if (typeof total === "number" && total >= 0 && total !== rows) {
      count.appendChild(el("span", undefined, ` of ${total} matching`));
    }
    if (payload.moreRecords) {
      count.appendChild(el("span", undefined, " · more available"));
    }
    if (payload.context && payload.context.rowCap !== undefined && payload.context.rowCap !== null) {
      count.appendChild(el("span", "capped", ` · capped at ${payload.context.rowCap} for this test run`));
    }
    els.summary.appendChild(count);

    // Stating the identity matters: the query ran as the CONNECTED user, not as whoever will run the
    // plugin, so row-level security and eq-userid resolve differently at runtime.
    const context = payload.context || {};
    const parts = [];
    if (context.organizationUrl) {
      parts.push(context.organizationUrl);
    }
    if (context.identity) {
      parts.push(`as ${context.identity}`);
    }
    if (parts.length > 0) {
      els.summary.appendChild(el("div", "ran-as", `Ran against ${parts.join(" ")}`));
    }
  }

  function renderGrid(payload) {
    els.grid.replaceChildren();
    if (payload.rows.length === 0) {
      els.grid.appendChild(el("div", "no-rows", "No rows matched."));
      return;
    }

    const table = el("table");
    const thead = el("thead");
    const headerRow = el("tr");
    for (const column of payload.columns) {
      const th = el("th", undefined, column.label);
      th.title = column.key;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    for (const row of payload.rows) {
      const tr = el("tr");
      for (const column of payload.columns) {
        const value = row[column.key];
        const td = el("td", value === undefined || value === "" ? "empty-value" : undefined, value === undefined ? "" : value);
        td.title = value === undefined ? "" : value;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    els.grid.appendChild(table);
  }

  els.copyCsv.addEventListener("click", () => vscode.postMessage({ type: "copyCsv" }));
  els.copyJson.addEventListener("click", () => vscode.postMessage({ type: "copyJson" }));
  els.copyXml.addEventListener("click", () => vscode.postMessage({ type: "copyXml" }));

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "results") {
      els.error.hidden = true;
      renderSummary(message.payload);
      renderGrid(message.payload);
    } else if (message.type === "error") {
      els.summary.replaceChildren(el("div", undefined, message.title));
      els.grid.replaceChildren();
      els.error.textContent = message.error;
      els.error.hidden = false;
    }
  });
})();
