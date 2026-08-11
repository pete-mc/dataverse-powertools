// @vitest-environment jsdom
//
// Webview DOM test for the FetchXML Generator's browser script (#238), following the pattern
// menuPanel.dom.spec.ts established: load the SHIPPING media/queryGenerator.js unchanged into jsdom,
// feed it real state over the message protocol, and assert both the rendered DOM and the intents it
// posts back. The host-side view-model (generatorState.ts) is unit-tested separately; this covers the
// half that turns it into DOM, which would otherwise have no coverage outside the UI suites.
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildState } from "./generatorState";
import { DEFAULT_FORMAT, parseFetchXml } from "./fetchXml";
import { QueryNode } from "./queryModel";

const SCRIPT = fs.readFileSync(path.resolve(__dirname, "../../media/queryGenerator.js"), "utf8");

interface PostedMessage {
  type: string;
  [key: string]: unknown;
}

/** The element ids generatorPanel.ts's HTML shell provides. Kept in step with that shell. */
const SHELL = `
  <div id="title"></div>
  <div id="notice" hidden></div>
  <div id="tree"></div>
  <div id="treeActions"></div>
  <div id="properties"></div>
  <div id="otherAttributes"></div>
  <div id="parameters"></div>
  <div id="diagnostics"></div>
  <textarea id="xml"></textarea>
  <div id="xmlError" hidden></div>
  <button id="run"></button>
  <button id="save"></button>
  <button id="copy"></button>
  <button id="refresh"></button>
`;

function loadBuilder(): { posted: PostedMessage[] } {
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

function postState(state: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state } }));
}

function rootOf(xml: string): QueryNode {
  const parsed = parseFetchXml(xml);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.root;
}

const QUERY = rootOf(`<fetch top="50">
  <entity name="account">
    <attribute name="name" />
    <filter type="and">
      <condition attribute="statecode" operator="eq" value="0" />
    </filter>
  </entity>
</fetch>`);

/** Real state, straight from the host's own view-model generator — no hand-written fixture to drift. */
function state(overrides: Partial<ReturnType<typeof buildState>> = {}, selection: number[] = []): ReturnType<typeof buildState> {
  return {
    ...buildState({
      root: QUERY,
      format: DEFAULT_FORMAT,
      selection,
      diagnostics: [],
      parameters: [],
      readOnly: false,
      consumerLabel: "FetchExpression (SDK)",
      title: "Plugin.cs",
      dirty: false,
    }),
    ...overrides,
  };
}

describe("queryGenerator.js (webview DOM)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("announces itself as ready so the host sends the first state", () => {
    const { posted } = loadBuilder();
    expect(posted).toEqual([{ type: "ready" }]);
  });

  it("renders the tree with one row per node, indented by depth", () => {
    loadBuilder();
    postState(state());
    const rows = [...document.querySelectorAll("#tree .row")];
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.querySelector(".tag")?.textContent)).toEqual(["fetch", "entity", "attribute", "filter", "condition"]);
    expect(rows.map((row) => row.querySelector(".label")?.textContent)).toEqual(["top 50", "account", "name", "AND", "statecode eq 0"]);
    expect((rows[4] as HTMLElement).style.paddingLeft).toBe("56px");
  });

  it("posts a select intent with the clicked node's path", () => {
    const { posted } = loadBuilder();
    postState(state());
    (document.querySelectorAll("#tree .row")[4] as HTMLElement).click();
    expect(posted).toContainEqual({ type: "select", path: [0, 1, 0] });
  });

  it("marks the selected row and offers the children that node can take", () => {
    loadBuilder();
    postState(state({}, [0, 1]));
    expect(document.querySelector("#tree .row.selected")?.querySelector(".label")?.textContent).toBe("AND");
    expect([...document.querySelectorAll("#treeActions button")].map((button) => button.textContent)).toEqual(["+ condition", "+ filter", "Remove", "Move up", "Move down"]);
  });

  it("has no Remove button when the root is selected", () => {
    loadBuilder();
    postState(state({}, []));
    expect([...document.querySelectorAll("#treeActions button")].map((button) => button.textContent)).toEqual(["+ entity"]);
  });

  it("posts an add intent for the selected path", () => {
    const { posted } = loadBuilder();
    postState(state({}, [0, 1]));
    ([...document.querySelectorAll("#treeActions button")].find((button) => button.textContent === "+ condition") as HTMLElement).click();
    expect(posted).toContainEqual({ type: "add", path: [0, 1], tag: "condition" });
  });

  it("renders the selected node's fields and posts setAttr on change", () => {
    const { posted } = loadBuilder();
    postState(state({}, [0, 1, 0]));

    const operator = document.getElementById("field-operator") as HTMLSelectElement;
    expect(operator).toBeTruthy();
    expect(operator.value).toBe("eq");
    // Operators arrive grouped, so the picker stays navigable at ~60 options.
    expect(operator.querySelectorAll("optgroup").length).toBeGreaterThan(3);

    const value = document.getElementById("field-value") as HTMLInputElement;
    value.value = "1";
    value.dispatchEvent(new Event("change"));
    expect(posted).toContainEqual({ type: "edit", edit: { kind: "setAttr", path: [0, 1, 0], name: "value", value: "1" } });
  });

  it("renders a checkbox for a boolean field and clears the attribute when unticked", () => {
    const { posted } = loadBuilder();
    postState(state({}, []));
    const distinct = document.getElementById("field-distinct") as HTMLInputElement;
    expect(distinct.type).toBe("checkbox");
    expect(distinct.checked).toBe(false);
    distinct.checked = true;
    distinct.dispatchEvent(new Event("change"));
    expect(posted).toContainEqual({ type: "edit", edit: { kind: "setAttr", path: [], name: "distinct", value: "true" } });

    distinct.checked = false;
    distinct.dispatchEvent(new Event("change"));
    expect(posted).toContainEqual({ type: "edit", edit: { kind: "setAttr", path: [], name: "distinct", value: "" } });
  });

  it("shows a loading placeholder until metadata arrives, then the tables", () => {
    loadBuilder();
    postState(state({}, [0]));
    expect((document.getElementById("field-name") as HTMLSelectElement).textContent).toContain("loading tables…");

    postState(state({ tables: [{ logicalName: "account", displayName: "Account" }] }, [0]));
    const picker = document.getElementById("field-name") as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toContain("account");
    expect(picker.value).toBe("account");
  });

  it("keeps a current value the picker doesn't offer, so selecting nothing can't silently change it", () => {
    loadBuilder();
    // Metadata loaded, but the query names a table it doesn't list.
    postState(state({ tables: [{ logicalName: "contact", displayName: "Contact" }] }, [0]));
    const picker = document.getElementById("field-name") as HTMLSelectElement;
    expect(picker.value).toBe("account");
    expect([...picker.options].map((option) => option.textContent)).toContain("account (current)");
  });

  it("renders parameters with their type as the placeholder and posts value changes", () => {
    const { posted } = loadBuilder();
    postState(state({ parameters: [{ name: "accountId", type: "guid", expression: "accountId", value: "" }] }));
    const input = document.getElementById("param-accountId") as HTMLInputElement;
    expect(input.placeholder).toBe("guid");
    expect(document.getElementById("parameters")?.textContent).toContain("Bound to `accountId`");

    input.value = "6b29fc40-ca47-1067-b31d-00dd010662da";
    input.dispatchEvent(new Event("change"));
    expect(posted).toContainEqual({ type: "setParameter", name: "accountId", value: "6b29fc40-ca47-1067-b31d-00dd010662da" });
  });

  it("lists diagnostics with a severity marker", () => {
    loadBuilder();
    postState(
      state({
        diagnostics: [
          { code: "unescapedValue", severity: "warning", message: "`term` is interpolated without escaping." },
          { code: "wrongRoot", severity: "error", message: "This consumer takes a <filter>." },
        ],
      }),
    );
    const rows = [...document.querySelectorAll("#diagnostics .diagnostic")];
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toContain("warning");
    expect(rows[0].querySelector(".severity")?.textContent).toBe("⚠");
    expect(rows[1].querySelector(".message")?.textContent).toContain("takes a <filter>");
  });

  it("surfaces attributes it has no field for rather than hiding them", () => {
    loadBuilder();
    postState(state({ otherAttributes: [{ name: "latematerialize", value: "true" }] }));
    expect(document.getElementById("otherAttributes")?.textContent).toContain("latematerialize = true");
  });

  it("shows the XML and only enables Save when there are unsaved changes", () => {
    loadBuilder();
    postState(state({ dirty: false }));
    expect((document.getElementById("xml") as HTMLTextAreaElement).value).toContain('<condition attribute="statecode"');
    expect((document.getElementById("save") as HTMLButtonElement).disabled).toBe(true);

    postState(state({ dirty: true }));
    expect((document.getElementById("save") as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById("title")?.textContent).toContain("unsaved");
  });

  it("posts the edited XML on blur and shows the parse error the host reports", () => {
    const { posted } = loadBuilder();
    postState(state());
    const xml = document.getElementById("xml") as HTMLTextAreaElement;
    xml.dispatchEvent(new Event("focus"));
    xml.value = "<fetch><entity></fetch>";
    xml.dispatchEvent(new Event("blur"));
    expect(posted).toContainEqual({ type: "setXml", xml: "<fetch><entity></fetch>" });

    window.dispatchEvent(new MessageEvent("message", { data: { type: "xmlError", error: "Closing tag mismatch" } }));
    const error = document.getElementById("xmlError") as HTMLElement;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe("Closing tag mismatch");
  });

  it("does not overwrite the XML box while it is being edited", () => {
    loadBuilder();
    postState(state());
    const xml = document.getElementById("xml") as HTMLTextAreaElement;
    xml.dispatchEvent(new Event("focus"));
    xml.value = "half-typed";
    postState(state({ dirty: true }));
    expect(xml.value).toBe("half-typed");
  });

  it("disables editing and explains itself when the query is read-only", () => {
    loadBuilder();
    postState(state({ readOnly: true }, [0, 1, 0]));
    const notice = document.getElementById("notice") as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("read-only");
    expect((document.getElementById("field-value") as HTMLInputElement).disabled).toBe(true);
    expect((document.getElementById("save") as HTMLButtonElement).disabled).toBe(true);
    expect([...document.querySelectorAll("#treeActions button")].every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it("posts the toolbar intents", () => {
    const { posted } = loadBuilder();
    postState(state({ dirty: true }));
    for (const id of ["run", "save", "copy", "refresh"]) {
      (document.getElementById(id) as HTMLElement).click();
    }
    expect(posted).toContainEqual({ type: "run" });
    expect(posted).toContainEqual({ type: "save" });
    expect(posted).toContainEqual({ type: "copyXml" });
    expect(posted).toContainEqual({ type: "refreshMetadata" });
  });

  it("renders org-supplied text as text, never as markup", () => {
    loadBuilder();
    // A table name containing angle brackets must not become an element.
    postState(state({ tables: [{ logicalName: "account", displayName: "<img src=x onerror=alert(1)>" }] }, [0]));
    expect(document.querySelector("#properties img")).toBeNull();
    expect((document.getElementById("field-name") as HTMLSelectElement).textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
