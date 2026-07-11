import * as assert from "assert";
import { ActivityBar, VSBrowser, ViewControl, WebviewView, BottomBarPanel, By } from "vscode-extension-tester";

// UI tests for the Actions panel webview (#100). These click the REAL buttons
// inside the webview iframe (deeper than the old open-the-container check) and
// assert on observable side effects. No workspace folder is open in this
// session, so the panel renders its Get Started state.

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function dismissOverlays(): Promise<void> {
  try {
    await VSBrowser.instance.driver.executeScript(
      "for (const s of ['.onboarding-a-overlay','.monaco-dialog-box','.monaco-dialog-modal-block','.notification-toast','.notifications-toasts']) { document.querySelectorAll(s).forEach(function(e){ e.remove(); }); }",
    );
  } catch {
    /* ignore */
  }
}

async function getViewControl(): Promise<ViewControl | undefined> {
  let control: ViewControl | undefined;
  for (let i = 0; i < 12 && !control; i++) {
    await dismissOverlays();
    control = await new ActivityBar().getViewControl("Dataverse PowerTools");
    if (!control) {
      await sleep(1000);
    }
  }
  return control;
}

/** Switch into the Actions panel webview iframe, retrying while it loads.
 * Re-opens our view each attempt (another extension's startup can steal the
 * side bar) and verifies the frame is OURS via the #root marker — a bare
 * WebviewView() would happily switch into any other extension's webview. */
async function openPanelFrame(): Promise<WebviewView> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await dismissOverlays();
    const control = await getViewControl();
    if (control) {
      try {
        await control.openView();
      } catch {
        /* retried below */
      }
    }
    await sleep(1000);
    const webview = new WebviewView();
    try {
      await webview.switchToFrame(5000);
      const marker = await webview.findWebElements(By.css("main#root"));
      if (marker.length > 0) {
        return webview;
      }
      await webview.switchBack();
    } catch {
      try {
        await webview.switchBack();
      } catch {
        /* not in a frame */
      }
    }
    await sleep(1000);
  }
  throw new Error("Could not switch into the Dataverse PowerTools actions panel webview");
}

async function cardIds(webview: WebviewView): Promise<string[]> {
  const cards = await webview.findWebElements(By.css("section[data-card-id]"));
  const ids = await Promise.all(cards.map((s) => s.getAttribute("data-card-id")));
  return ids.filter((id): id is string => id !== null);
}

async function findButton(webview: WebviewView, label: string) {
  const buttons = await webview.findWebElements(By.css("button"));
  for (const button of buttons) {
    if ((await button.getText()).trim() === label) {
      return button;
    }
  }
  return undefined;
}

describe("Dataverse PowerTools actions panel", function () {
  this.timeout(180000);

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
    await sleep(1500);
    await dismissOverlays();
    const control = await getViewControl();
    assert.ok(control, "Expected the Dataverse PowerTools view container");
    await control.openView();
    await sleep(2000);
    await dismissOverlays();
  });

  it("renders the Get Started cards with requirements in the webview", async () => {
    const webview = await openPanelFrame();
    try {
      let ids: string[] = [];
      for (let i = 0; i < 15 && !ids.includes("getStarted"); i++) {
        ids = await cardIds(webview);
        if (!ids.includes("getStarted")) {
          await sleep(1000);
        }
      }
      assert.ok(ids.includes("getStarted"), `Expected a getStarted card; got: [${ids.join(", ")}]`);
      assert.ok(ids.includes("requirements"), `Expected a requirements card; got: [${ids.join(", ")}]`);

      const initialise = await findButton(webview, "Initialise Project");
      assert.ok(initialise, "Expected an Initialise Project button");
      const initialiseClass = (await initialise.getAttribute("class")) ?? "";
      assert.ok(initialiseClass.includes("primary"), "Initialise Project should be the primary action");

      const walkthrough = await findButton(webview, "Open Walkthrough");
      assert.ok(walkthrough, "Expected an Open Walkthrough button");

      // Three requirement rows (dotnet/node/pac), each resolved to ✓/✗ once the scan ends.
      let rows = await webview.findWebElements(By.css("ul.requirements li"));
      for (let i = 0; i < 15 && rows.length < 3; i++) {
        await sleep(1000);
        rows = await webview.findWebElements(By.css("ul.requirements li"));
      }
      assert.strictEqual(rows.length, 3, "Expected exactly three requirement rows");

      // Footer always carries the log entry point.
      const footer = await webview.findWebElements(By.css("footer.panel-footer"));
      assert.strictEqual(footer.length, 1, "Expected the panel footer");
    } finally {
      await webview.switchBack();
    }
  });

  it("runs a command when a panel button is clicked", async () => {
    const webview = await openPanelFrame();
    try {
      const showLog = await findButton(webview, "Show Log");
      assert.ok(showLog, "Expected a Show Log button in the footer");
      await showLog.click();
    } finally {
      await webview.switchBack();
    }

    // Show Log calls channel.show(true) — the bottom panel must open on the
    // extension's output channel (it prints the logo + version on activation).
    let text = "";
    for (let i = 0; i < 15 && !/version:/.test(text); i++) {
      try {
        const output = await new BottomBarPanel().openOutputView();
        text = await output.getText();
      } catch {
        /* panel still opening */
      }
      if (!/version:/.test(text)) {
        await sleep(1000);
      }
    }
    assert.ok(/version:/.test(text), "Expected the dataverse-powertools output channel to open with its activation banner");
  });
});
