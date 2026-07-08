import * as assert from "assert";
import { ActivityBar, VSBrowser } from "vscode-extension-tester";

// True UI-level test driven by ExTester (Selenium/WebDriver against the real
// VS Code UI). Use this layer only for things the extension-host API can't
// assert directly. Kept resilient to CI flakiness: strip VS Code's onboarding
// overlay (which intercepts interaction on a fresh install) and poll for the
// view control instead of asserting on the first try. `retries` is set in
// .mocharc-ui.json.

async function dismissOverlays(): Promise<void> {
  try {
    await VSBrowser.instance.driver.executeScript(
      "for (const s of ['.onboarding-a-overlay','.monaco-dialog-box','.notification-toast','.notifications-toasts']) { document.querySelectorAll(s).forEach(function(e){ e.remove(); }); }",
    );
  } catch {
    /* ignore */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("Dataverse PowerTools activity bar", function () {
  this.timeout(120000);

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
    await sleep(1500);
    await dismissOverlays();
  });

  it("contributes the Dataverse PowerTools view container", async () => {
    let control;
    for (let i = 0; i < 12 && !control; i++) {
      await dismissOverlays();
      control = await new ActivityBar().getViewControl("Dataverse PowerTools");
      if (!control) {
        await sleep(1000);
      }
    }
    assert.ok(control, "Expected the Dataverse PowerTools view container in the activity bar");
  });
});
