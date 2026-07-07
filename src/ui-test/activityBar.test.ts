import * as assert from "assert";
import { ActivityBar, VSBrowser } from "vscode-extension-tester";

// True UI-level test driven by ExTester (Selenium/WebDriver against the real
// VS Code UI). Use this layer only for things the extension-host API can't
// assert directly — clicking tree items, opening context menus, welcome-view
// buttons. For "did my command do X" prefer a faster integration test under
// `src/test/suite`.
describe("Dataverse PowerTools activity bar", function () {
  this.timeout(120000);

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
  });

  it("contributes the Dataverse PowerTools view container", async () => {
    const control = await new ActivityBar().getViewControl("Dataverse PowerTools");
    assert.ok(control, "Expected the Dataverse PowerTools view container in the activity bar");
  });
});
