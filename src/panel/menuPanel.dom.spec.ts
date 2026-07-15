// @vitest-environment jsdom
//
// Webview DOM test (#143 — "test the webview DOM"). The panel's browser script,
// media/menuPanel.js, was previously untested anywhere: the host-side view-model
// (menuModel.ts) has unit tests, but the script that turns that model into DOM
// and posts clicks back had zero coverage. This loads the SHIPPING script
// unchanged into jsdom, feeds it a representative model over the `message`
// protocol, and asserts the rendered DOM + the messages it posts. No source
// change to the browser code — so it adds coverage with no regression risk to
// the live panel (the drag-and-drop internals stay covered by the ExTester/UI
// suites, which are the only thing that can truly exercise real DnD).
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SCRIPT = fs.readFileSync(path.resolve(__dirname, "../../media/menuPanel.js"), "utf8");

interface PostedMessage {
  type: string;
  [k: string]: unknown;
}

/** Load menuPanel.js into the current jsdom document with a stubbed VS Code API,
 * returning the list the script posts to (captures postMessage payloads). */
function loadPanel(): { posted: PostedMessage[] } {
  const posted: PostedMessage[] = [];
  // The IIFE calls acquireVsCodeApi() at load; it must resolve as a global.
  (globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: (m: PostedMessage) => posted.push(m),
    getState: () => undefined,
    setState: () => undefined,
  });
  document.body.innerHTML = '<div id="root"></div>';
  // Evaluate the browser script in this jsdom realm (it reads acquireVsCodeApi/document as globals).
  new Function(SCRIPT)();
  return { posted };
}

/** Dispatch the host→webview model message the script listens for. */
function postModel(model: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data: { type: "model", model } }));
}

const footer = { log: { label: "Show Log", command: "dvpt.log" }, requirementsOk: true };

describe("menuPanel.js (webview DOM, #143)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("posts a `ready` message as soon as it loads", () => {
    const { posted } = loadPanel();
    expect(posted).toEqual([{ type: "ready" }]);
  });

  it("renders one card section per model card and tags each with its id", () => {
    const { posted } = loadPanel();
    posted.length = 0;
    postModel({
      cards: [
        { kind: "notice", id: "n1", text: "Loading…" },
        { kind: "actions", id: "a1", actions: [{ label: "Deploy", command: "dvpt.deploy" }] },
      ],
      footer,
    });
    const cards = document.querySelectorAll("#root > .card");
    expect(cards.length).toBe(2);
    expect(document.querySelector('[data-card-id="n1"]')?.textContent).toContain("Loading…");
    expect(document.querySelector('[data-card-id="a1"] button')?.textContent).toBe("Deploy");
  });

  it("posts an `execute` message with the action command when an action button is clicked", () => {
    const { posted } = loadPanel();
    postModel({
      cards: [{ kind: "actions", id: "a1", actions: [{ label: "Deploy", command: "dvpt.deploy", args: [1] }] }],
      footer,
    });
    posted.length = 0;
    (document.querySelector('[data-card-id="a1"] button') as HTMLButtonElement).click();
    expect(posted).toEqual([{ type: "execute", command: "dvpt.deploy", args: [1] }]);
  });

  it("renders the trace-log pill and posts its execute action on click (#137)", () => {
    const { posted } = loadPanel();
    postModel({
      cards: [
        {
          kind: "environment",
          id: "env",
          name: "Contoso",
          connected: true,
          url: "https://contoso.crm.dynamics.com",
          authLabel: "OAuth",
          switchAction: { label: "Switch", command: "dvpt.switch" },
          overflow: [],
          traceLog: { label: "Trace: All", colour: "red", action: { command: "dvpt.setTraceLogLevel" } },
        },
      ],
      footer,
    });
    const pill = document.querySelector(".tracepill") as HTMLButtonElement;
    expect(pill).toBeTruthy();
    expect(pill.textContent).toBe("Trace: All");
    expect(pill.className).toContain("trace-red");
    posted.length = 0;
    pill.click();
    expect(posted).toEqual([{ type: "execute", command: "dvpt.setTraceLogLevel", args: [] }]);
  });

  it("renders the device-code sign-in card and posts copy/open intents (no values in the message)", () => {
    const { posted } = loadPanel();
    postModel({
      cards: [
        {
          kind: "signin",
          id: "signin",
          title: "Signing in to Power Platform CLI",
          hint: "Open the sign-in page and enter this code to continue:",
          url: "https://microsoft.com/devicelogin",
          code: "ABCD-EFGH",
        },
      ],
      footer,
    });
    const signin = document.querySelector(".card.signin") as HTMLElement;
    expect(signin).toBeTruthy();
    expect(signin.querySelector(".devicecode")?.textContent).toBe("ABCD-EFGH");
    expect(signin.textContent).toContain("https://microsoft.com/devicelogin");

    posted.length = 0;
    (signin.querySelector(".signin-actions button.primary") as HTMLButtonElement).click();
    expect(posted).toEqual([{ type: "copyDeviceCode" }]);

    posted.length = 0;
    const buttons = signin.querySelectorAll(".signin-actions button");
    (buttons[buttons.length - 1] as HTMLButtonElement).click();
    expect(posted).toEqual([{ type: "openSignInPage" }]);
  });

  it("renders a requirements card and posts openExternal for a missing tool's Download link", () => {
    const { posted } = loadPanel();
    postModel({
      cards: [
        {
          kind: "requirements",
          id: "req",
          rows: [
            { label: "dotnet", ok: true },
            { label: "pac", ok: false, downloadUrl: "https://aka.ms/pac" },
          ],
        },
      ],
      footer,
    });
    const link = document.querySelector(".requirements a.download") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    posted.length = 0;
    link.click();
    expect(posted).toEqual([{ type: "openExternal", url: "https://aka.ms/pac" }]);
  });

  it("offers the new-group drop zone only once at least two project cards are arrangeable", () => {
    loadPanel();
    const project = (id: string, name: string) => ({
      kind: "project",
      id,
      dndId: id,
      name,
      typeLabel: "Plugin",
      overflow: [],
      primary: { label: "Deploy", command: "dvpt.deploy" },
      secondary: [],
    });
    // One arrangeable project → no group zone.
    postModel({ cards: [project("p1", "A")], footer });
    expect(document.querySelector(".new-group-zone")).toBeFalsy();
    // Two arrangeable projects → group zone appears.
    postModel({ cards: [project("p1", "A"), project("p2", "B")], footer });
    expect(document.querySelector(".new-group-zone")).toBeTruthy();
  });

  it("clears prior cards on each model message (no stale DOM)", () => {
    loadPanel();
    postModel({ cards: [{ kind: "notice", id: "n1", text: "First" }], footer });
    expect(document.querySelectorAll("#root > .card").length).toBe(1);
    postModel({ cards: [{ kind: "notice", id: "n2", text: "Second" }], footer });
    const cards = document.querySelectorAll("#root > .card");
    expect(cards.length).toBe(1);
    expect(document.querySelector('[data-card-id="n2"]')?.textContent).toContain("Second");
    expect(document.querySelector('[data-card-id="n1"]')).toBeFalsy();
  });

  it("ignores messages that are not the model type", () => {
    loadPanel();
    postModel({ cards: [{ kind: "notice", id: "n1", text: "Real" }], footer });
    window.dispatchEvent(new MessageEvent("message", { data: { type: "somethingElse" } }));
    // The real model is still rendered, untouched.
    expect(document.querySelector('[data-card-id="n1"]')?.textContent).toContain("Real");
  });
});
