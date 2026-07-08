import * as assert from "assert";
import { ActivityBar, VSBrowser, ViewControl } from "vscode-extension-tester";

// True UI-level tests driven by ExTester (Selenium/WebDriver against the real
// VS Code UI). Use this layer only for things the extension-host API can't
// assert directly. Kept resilient to CI flakiness: strip VS Code's onboarding
// overlay (which intercepts interaction on a fresh install) and poll instead of
// asserting on the first try. `retries` is set in .mocharc-ui.json.

async function dismissOverlays(): Promise<void> {
  try {
    await VSBrowser.instance.driver.executeScript(
      "for (const s of ['.onboarding-a-overlay','.monaco-dialog-box','.monaco-dialog-modal-block','.notification-toast','.notifications-toasts']) { document.querySelectorAll(s).forEach(function(e){ e.remove(); }); }",
    );
  } catch {
    /* ignore */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll for the Dataverse PowerTools activity-bar view control (fresh installs are slow). */
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

describe("Dataverse PowerTools activity bar", function () {
  this.timeout(120000);

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
    await sleep(1500);
    await dismissOverlays();
  });

  it("contributes the Dataverse PowerTools view container", async () => {
    const control = await getViewControl();
    assert.ok(control, "Expected the Dataverse PowerTools view container in the activity bar");
  });

  it("renders its contributed tree views", async () => {
    const control = await getViewControl();
    assert.ok(control, "Expected the Dataverse PowerTools view container");
    const sideBar = await control.openView();
    await sleep(1000);
    await dismissOverlays();

    let titles: string[] = [];
    for (let i = 0; i < 10 && titles.length === 0; i++) {
      try {
        const sections = await sideBar.getContent().getSections();
        titles = await Promise.all(sections.map((s) => s.getTitle().catch(() => "")));
      } catch {
        /* view still rendering */
      }
      if (titles.length === 0) {
        await sleep(1000);
      }
    }

    assert.ok(
      titles.some((t) => /System Requirements|Local Settings|Actions/i.test(t)),
      `Expected a known Dataverse PowerTools view section; got: [${titles.join(", ")}]`,
    );
  });
});
