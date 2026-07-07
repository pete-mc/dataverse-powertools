import * as path from "path";
import * as fs from "fs";
import { VSBrowser, ActivityBar, Workbench, InputBox } from "vscode-extension-tester";

// Capture screenshots of the real extension UI for use in the README + wiki.
// Run directly: extest setup-and-run out/ui-test/screenshots.test.js --code_settings sandbox/vscode-settings.json
const repoRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(repoRoot, "sandbox", "screenshots-out");
const fixtures = path.resolve(repoRoot, "sandbox", "screens");

async function snap(name: string): Promise<void> {
  const img = await VSBrowser.instance.driver.takeScreenshot();
  fs.writeFileSync(path.join(outDir, `${name}.png`), img, "base64");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// Remove VS Code's onboarding overlay / dialogs / toasts that intercept clicks.
async function dismissOverlays(): Promise<void> {
  try {
    await VSBrowser.instance.driver.executeScript(
      "for (const s of ['.onboarding-a-overlay','.monaco-dialog-box','.notifications-toasts','.notification-toast']) { document.querySelectorAll(s).forEach(function(e){ e.remove(); }); }",
    );
  } catch {
    /* ignore */
  }
  await sleep(300);
}

// Activation reads settings and prompts for a connection string. Fill the multi-step
// prompt with throwaway values so initialization COMPLETES and the menu renders (the
// creds are never used — no real connection is made in a screenshot run).
async function fillPrompts(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    try {
      const input = await InputBox.create(12000);
      await input.setText("dvptshot");
      await input.confirm();
      await sleep(800);
    } catch {
      break;
    }
  }
}

async function openProject(kind: string): Promise<void> {
  await VSBrowser.instance.openResources(path.join(fixtures, kind));
  await VSBrowser.instance.waitForWorkbench();
  await sleep(2500);
  await dismissOverlays();
  await fillPrompts();
  await dismissOverlays();
  await sleep(1500);
  const control = await new ActivityBar().getViewControl("Dataverse PowerTools");
  await control?.openView();
  await sleep(1500);
  await fillPrompts();
  await dismissOverlays();
  await sleep(2500);
}

describe("Dataverse PowerTools screenshots", function () {
  this.timeout(240000);

  before(async () => {
    fs.mkdirSync(outDir, { recursive: true });
    await VSBrowser.instance.waitForWorkbench();
    await dismissOverlays();
  });

  it("captures the command palette command surface", async () => {
    await dismissOverlays();
    const prompt = await new Workbench().openCommandPrompt();
    await prompt.setText(">Dataverse PowerTools");
    await sleep(1500);
    await snap("commands");
    await prompt.cancel();
  });

  it("captures the plugin project menu", async () => {
    await openProject("plugin");
    await snap("plugin-menu");
  });

  it("captures the webresource project menu", async () => {
    await openProject("webresource");
    await snap("webresource-menu");
  });

  it("captures the solution project menu", async () => {
    await openProject("solution");
    await snap("solution-menu");
  });
});
