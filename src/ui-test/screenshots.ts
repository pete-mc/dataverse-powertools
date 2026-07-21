import * as path from "path";
import * as fs from "fs";
import { VSBrowser, ActivityBar, Workbench, InputBox, WebviewView, BottomBarPanel, By } from "vscode-extension-tester";

// Local asset generator (NOT part of the CI ui-test glob — filename is `.ts`, not
// `.test.ts`). Captures screenshots of the real extension UI for the README + wiki.
// Requires the gitignored `sandbox/screens` fixtures; skips if they're absent.
// Run: npm run compile-tests && npm run compile && extest setup-and-run out/ui-test/screenshots.js \
//        --code_settings sandbox/vscode-settings.json --extensions_dir sandbox/ext-dir-shot --mocha_config .mocharc-ui.json
// Output: sandbox/screenshots-out/*.png. Sidebar captures are element screenshots of
// `.part.sidebar` (same framing as the 360x1230 store images in media/).
const repoRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(repoRoot, "sandbox", "screenshots-out");
const fixtures = path.resolve(repoRoot, "sandbox", "screens");

/** Move the mouse off the activity bar and kill hover tooltips — a lingering
 * pointer leaves a "Dataverse PowerTools" tooltip across the screenshot. */
async function parkPointer(): Promise<void> {
  const driver = VSBrowser.instance.driver;
  try {
    const editor = await driver.findElement(By.css(".part.editor"));
    await driver.actions({ async: true }).move({ origin: editor }).perform();
  } catch {
    /* no editor part — ignore */
  }
  try {
    await driver.executeScript("document.querySelectorAll('.monaco-hover').forEach(function(e){ e.remove(); });");
  } catch {
    /* ignore */
  }
  await sleep(500);
}

async function snap(name: string): Promise<void> {
  await parkPointer();
  const img = await VSBrowser.instance.driver.takeScreenshot();
  fs.writeFileSync(path.join(outDir, `${name}.png`), img, "base64");
}

/** Screenshot of the side bar element only — clean crop for the store/README. */
async function snapSidebar(name: string): Promise<void> {
  await parkPointer();
  try {
    const sidebar = await VSBrowser.instance.driver.findElement(By.css(".part.sidebar"));
    const img = await sidebar.takeScreenshot();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img, "base64");
  } catch {
    const img = await VSBrowser.instance.driver.takeScreenshot();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img, "base64"); // full window beats losing the shot
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// Remove VS Code's onboarding overlay / dialogs / toasts that intercept clicks.
async function dismissOverlays(): Promise<void> {
  try {
    await VSBrowser.instance.driver.executeScript(
      "for (const s of ['.onboarding-a-overlay','.monaco-dialog-box','.monaco-dialog-modal-block','.notifications-toasts','.notification-toast']) { document.querySelectorAll(s).forEach(function(e){ e.remove(); }); }",
    );
  } catch {
    /* ignore */
  }
  await sleep(300);
}

// The fixtures use OAuth connection strings, which load without any credential
// prompts. Keep a short prompt-drain anyway in case a wizard appears.
async function fillPrompts(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    try {
      const input = await InputBox.create(3000);
      await input.setText("dvptshot");
      await input.confirm();
      await sleep(600);
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

/** Open a file (relative to the fixtures root) in the editor and settle. */
async function openFileInEditor(relPath: string): Promise<void> {
  await VSBrowser.instance.openResources(path.join(fixtures, relPath));
  await sleep(2500);
  await dismissOverlays();
  await sleep(1500);
}

/** Switch into the actions panel webview (verified via its #root marker). */
async function openPanelFrame(): Promise<WebviewView> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await dismissOverlays();
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
  throw new Error("Could not switch into the actions panel webview");
}

describe("Dataverse PowerTools screenshots", function () {
  this.timeout(420000);

  before(async function () {
    if (!fs.existsSync(fixtures)) {
      this.skip();
    }
    fs.mkdirSync(outDir, { recursive: true });
    await VSBrowser.instance.waitForWorkbench();
    await dismissOverlays();
  });

  it("captures the Get Started panel state", async () => {
    await openProject("empty");
    await snapSidebar("get-started");
  });

  it("captures the blank (Empty — components in subfolders) project menu", async () => {
    await openProject("blank");
    await snapSidebar("blank-menu");
  });

  it("captures the Getting Started walkthrough", async () => {
    // Click the panel's own Open Walkthrough button — exercises the real flow.
    const webview = await openPanelFrame();
    try {
      const buttons = await webview.findWebElements(By.css("button.action"));
      for (const button of buttons) {
        if ((await button.getText()).trim() === "Open Walkthrough") {
          await button.click();
          break;
        }
      }
    } finally {
      await webview.switchBack();
    }
    await sleep(3000);
    await dismissOverlays();
    await snap("walkthrough");
  });

  it("captures the command palette command surface", async () => {
    await dismissOverlays();
    const prompt = await new Workbench().openCommandPrompt();
    await prompt.setText(">Dataverse PowerTools");
    await sleep(1500);
    await snap("commands");
    await prompt.cancel();
  });

  it("captures the multi-component workspace panel (#47)", async () => {
    await openProject("multi");
    await snapSidebar("multi-component");
  });

  it("captures the plugin project menu", async () => {
    await openProject("plugin");
    await snapSidebar("plugin-menu");
  });

  it("captures the plugin card Debugging block (cropped)", async () => {
    await openProject("plugin");
    await snapSidebar("debug-plugin-panel");
  });

  it("captures the Profile & Debug CodeLens on a [CrmPluginRegistration] class (#136)", async () => {
    await openProject("plugin");
    await openFileInEditor(path.join("plugin", "Contoso.Plugins", "AccountPostCreate.cs"));
    await snap("debug-codelens");
  });

  it("captures the generated Replay & debug unit test (#136/#138)", async () => {
    await openProject("plugin");
    await openFileInEditor(path.join("plugin", "Contoso.Plugins.Tests", "Replay_AccountPostCreate_20260717_161200.cs"));
    await snap("debug-replay-test");
  });

  it("captures the shared in-process replay harness DvptProfileReplay.cs (#138)", async () => {
    await openProject("plugin");
    await openFileInEditor(path.join("plugin", "Contoso.Plugins.Tests", "DvptProfileReplay.cs"));
    await snap("debug-replay-harness");
  });

  it("captures the replay test PASSING green in the terminal — in-process, no live org (#138/#210)", async () => {
    // The plugingreen fixture's .vscode/tasks.json auto-runs `dotnet test` on folder open (no typing —
    // keyboard automation is unreliable off the VM), so the terminal fills with the real run + Passed!.
    await openProject("plugingreen");
    // Show the generated test above the auto-run terminal so the frame reads code → green result.
    await openFileInEditor(path.join("plugingreen", "Contoso.Plugins.Tests", "Replay_AccountPostCreate_20260717_161200.cs"));
    let terminal: import("vscode-extension-tester").TerminalView | undefined;
    try {
      terminal = await new BottomBarPanel().openTerminalView();
      for (let i = 0; i < 120; i++) {
        let text = "";
        try {
          text = await terminal.getText();
        } catch {
          /* terminal text not ready */
        }
        if (/Passed!/.test(text)) {
          break;
        }
        await sleep(1000);
      }
    } catch {
      /* terminal view unavailable — snapshot whatever state we reached */
    }
    await sleep(1000);
    await snap("debug-replay-green");
  });

  it("captures a rendered plugin trace-log document (#136/#138)", async () => {
    await openProject("plugin");
    await openFileInEditor(path.join("plugin", "sample-trace-log.md"));
    // Open the Markdown preview to the side — the form the View Plugin Trace Logs command shows.
    try {
      await new Workbench().executeCommand("Markdown: Open Preview");
      await sleep(2500);
    } catch {
      /* preview unavailable — the source view still illustrates the doc */
    }
    await dismissOverlays();
    await snap("debug-trace-log");
  });

  it("captures the webresource project menu", async () => {
    await openProject("webresource");
    await snapSidebar("webresource-menu");
  });

  it("captures the solution project menu", async () => {
    await openProject("solution");
    await snapSidebar("solution-menu");
  });
});
