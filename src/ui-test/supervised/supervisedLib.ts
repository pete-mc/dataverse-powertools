import * as fs from "fs";
import * as path from "path";
import { ActivityBar, VSBrowser, ViewControl, WebviewView, By, WebElement } from "vscode-extension-tester";
// Reuse the proven e2e primitives rather than re-implementing them.
import { sleep, dismissOverlays, shot } from "../e2e/lib";

// ─────────────────────────────────────────────────────────────────────────────
// Supervised UI-test harness.
//
// Unlike the automated e2e suites (which drive commands through the command
// palette), this harness clicks the REAL panel buttons in the webview — the same
// wiring a user clicks — and PAUSES for a human at the steps automation can't do
// (OAuth sign-in, pac device-code). It is deliberately slow, narrated, and
// screenshots every step so you can watch it live and see exactly where a flow
// breaks. It is NOT run in CI; run it on demand with `npm run test:supervised`.
// ─────────────────────────────────────────────────────────────────────────────

let stepCounter = 0;
const shotsDir = path.resolve(__dirname, "..", "..", "..", "sandbox", "supervised-shots");

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Narrate a step to the console (a big, greppable banner) and screenshot it. */
export async function narrate(message: string): Promise<void> {
  stepCounter += 1;
  const banner = `\n${"═".repeat(78)}\n  STEP ${stepCounter}: ${message}\n${"═".repeat(78)}`;
  console.log(banner);
  await screenshot(`step-${String(stepCounter).padStart(2, "0")}`);
}

/** A prominent call to action when the test needs a human — with the step it's waiting on. */
export function actionBanner(message: string): void {
  console.log(`\n${"▓".repeat(78)}\n  🙋 ACTION NEEDED\n  ${message}\n${"▓".repeat(78)}\n`);
}

export async function screenshot(name: string): Promise<void> {
  try {
    fs.mkdirSync(shotsDir, { recursive: true });
    const img = await VSBrowser.instance.driver.takeScreenshot();
    fs.writeFileSync(path.join(shotsDir, `${ts()}_${name.replace(/[^a-z0-9]+/gi, "-")}.png`), img, "base64");
  } catch {
    /* screenshots are best-effort */
  }
}

/**
 * Briefly outline an element so it's obvious what's about to be clicked.
 *
 * Clears any outline left by an EARLIER call first. These outlines used to be applied and never
 * removed, so by the end of a run every button that had ever been clicked was still ringed in orange —
 * which in a published screenshot reads as "all of these are part of this step".
 */
async function highlight(el: WebElement): Promise<void> {
  try {
    await clearHighlights();
    await VSBrowser.instance.driver.executeScript(
      "arguments[0].dataset.dvptHl = '1'; arguments[0].style.outline = '3px solid #f80'; arguments[0].scrollIntoView({block:'center'});",
      el,
    );
    await sleep(700);
  } catch {
    /* best-effort */
  }
}

/** Remove every outline this module applied. Call inside the frame that owns them. */
async function clearHighlights(): Promise<void> {
  try {
    await VSBrowser.instance.driver.executeScript(`for (const el of document.querySelectorAll('[data-dvpt-hl]')) { el.style.outline = ''; delete el.dataset.dvptHl; }`);
  } catch {
    /* best-effort */
  }
}

// ── Activity-bar + panel webview (proven in src/ui-test/menuPanel.test.ts) ──────

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

/** Switch into the Actions panel webview iframe, verifying it's OURS via #root. */
export async function openPanelFrame(): Promise<WebviewView> {
  for (let attempt = 0; attempt < 12; attempt++) {
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

/** Run a function with the panel frame in focus, always switching back after. */
export async function withPanel<T>(fn: (panel: WebviewView) => Promise<T>): Promise<T> {
  const panel = await openPanelFrame();
  try {
    return await fn(panel);
  } finally {
    try {
      await panel.switchBack();
    } catch {
      /* not in a frame */
    }
  }
}

async function findButtonEl(panel: WebviewView, label: string, contains: boolean): Promise<WebElement | undefined> {
  const buttons = await panel.findWebElements(By.css("button"));
  for (const button of buttons) {
    try {
      const text = (await button.getText()).trim();
      if (contains ? text.includes(label) : text === label) {
        return button;
      }
    } catch {
      /* stale — skip */
    }
  }
  return undefined;
}

/** Click a panel button by its visible label — narrated, highlighted, then clicked.
 * Re-opens the frame and polls, since the panel re-renders as state changes. Some
 * labels carry decoration (e.g. "＋ Add Component…"), so pass `contains: true` to match
 * a substring. */
export async function clickPanelButton(label: string, opts: { timeoutMs?: number; contains?: boolean; shot?: string } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  await narrate(`Click panel button: "${label}"${opts.contains ? " (substring)" : ""}`);
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const clicked = await withPanel(async (panel) => {
        let button = await findButtonEl(panel, label, opts.contains ?? false);
        if (!button) {
          // The button may be on a COLLAPSED component card (#156) — a panel re-render can
          // re-collapse it at any time, so expand within this same frame and re-find.
          await expandCaretsInFrame(panel);
          button = await findButtonEl(panel, label, opts.contains ?? false);
        }
        if (!button) {
          return false;
        }
        await highlight(button);
        // Capture the documentation frame while the button is outlined — takeScreenshot grabs the
        // whole window, so being inside the panel iframe here does not matter.
        if (opts.shot) {
          await shot(opts.shot);
        }
        await button.click();
        // Drop the outline now the frame is captured, while we are still inside the panel iframe that
        // owns it — otherwise it survives into every later screenshot.
        await clearHighlights();
        return true;
      });
      if (clicked) {
        await sleep(1200);
        return;
      }
      lastError = `button "${label}" not found`;
    } catch (error) {
      lastError = `${error}`;
    }
    await sleep(1500);
  }
  await screenshot(`FAILED-click-${label}`);
  throw new Error(`clickPanelButton timed out for "${label}" after ${timeoutMs}ms (${lastError})`);
}

/** Click every "Expand" caret in the CURRENTLY-FOCUSED panel frame. The caret is a tiny button
 * (coordinate clicks miss it), so fire its handler via JS. Multi-component cards open minimised
 * (#156), hiding "Generate Earlybound"/"Local Build"/etc.; clickPanelButton calls this on a miss,
 * so a re-render that re-collapses a card can't defeat a click. */
async function expandCaretsInFrame(panel: WebviewView): Promise<void> {
  const carets = await panel.findWebElements(By.css("button.caret"));
  for (const caret of carets) {
    try {
      const label = (await caret.getAttribute("aria-label")) ?? "";
      if (label.startsWith("Expand")) {
        await VSBrowser.instance.driver.executeScript("arguments[0].click();", caret);
        await sleep(500);
      }
    } catch {
      /* stale — skip */
    }
  }
}

/** Expand collapsed component cards (best-effort, narrated). clickPanelButton also self-expands,
 * so this is mostly for an explicit, visible step. */
export async function expandComponentCards(): Promise<void> {
  await narrate("Expand component card(s) so their action buttons are visible");
  await withPanel((panel) => expandCaretsInFrame(panel));
  await sleep(600);
}

/** Open a component card's ⋯ overflow menu and click the item with the given label — the real
 * flow a user does for the rarer actions (New class, Add form registration, …). Tries each
 * card's ⋯ (skipping the environment card) until the menu shows the item. Fires clicks via JS
 * (the ⋯ and its popup rows are tiny + can be intercepted by a coordinate click). */
export async function clickOverflowItem(itemLabel: string, opts: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  await narrate(`Overflow menu → "${itemLabel}"`);
  const driver = VSBrowser.instance.driver;
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const clicked = await withPanel(async (panel) => {
        await expandCaretsInFrame(panel);
        const overflows = await panel.findWebElements(By.css("button.iconbtn[aria-haspopup='menu']"));
        for (const overflow of overflows) {
          const owner = (await overflow.getAttribute("aria-label").catch(() => "")) ?? "";
          if (/environment/i.test(owner)) {
            continue; // the env-card ⋯ (Open environment / Admin Center / …), not a component action
          }
          await driver.executeScript("arguments[0].click();", overflow);
          await sleep(500);
          const items = await panel.findWebElements(By.css(".overflow-menu button.menu-item"));
          for (const item of items) {
            if ((await item.getText().catch(() => "")).trim() === itemLabel) {
              await driver.executeScript("arguments[0].click();", item);
              return true;
            }
          }
          await driver.executeScript("arguments[0].click();", overflow); // close this menu, try the next ⋯
          await sleep(300);
        }
        return false;
      });
      if (clicked) {
        await sleep(1500);
        return;
      }
      lastError = `overflow item "${itemLabel}" not found in any card menu`;
    } catch (error) {
      lastError = `${error}`;
    }
    await sleep(1500);
  }
  await screenshot(`FAILED-overflow-${itemLabel}`);
  throw new Error(`clickOverflowItem timed out for "${itemLabel}" after ${timeoutMs}ms (${lastError})`);
}

/** True when the panel shows a live Dataverse connection (the green dot). */
export async function isConnected(): Promise<boolean> {
  try {
    return await withPanel(async (panel) => {
      const dots = await panel.findWebElements(By.css("span.dot.on"));
      return dots.length > 0;
    });
  } catch {
    return false;
  }
}

/** The org header text ("<url> · <auth>") once connected, for logging/assertions. */
export async function connectionSummary(): Promise<string> {
  try {
    return await withPanel(async (panel) => {
      const small = await panel.findWebElements(By.css("section.card div.small"));
      for (const el of small) {
        const text = (await el.getText()).trim();
        if (text.includes("·")) {
          return text;
        }
      }
      return "";
    });
  } catch {
    return "";
  }
}

// ── Human-in-the-loop ───────────────────────────────────────────────────────

/**
 * Pause for a human step (OAuth sign-in, pac device-code) and RESUME automatically
 * once `until()` becomes true. Prints a heartbeat so it's obvious it's waiting, not
 * hung. Throws on timeout so the run stops at the exact step you were on.
 */
export async function pauseForHuman(message: string, until: () => Promise<boolean>, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000; // 10 min — generous for a sign-in
  const pollMs = opts.pollMs ?? 4000;
  // Reuse mode / already-authenticated: if the condition is ALREADY met, don't nag for a
  // human — just continue. This is what makes an unattended reuse run quiet.
  if (await until().catch(() => false)) {
    console.log(`  ✓ "${message}" — already satisfied, continuing.`);
    return;
  }
  actionBanner(message);
  await screenshot("awaiting-human");
  const deadline = Date.now() + timeoutMs;
  let beats = 0;
  while (Date.now() < deadline) {
    if (await until().catch(() => false)) {
      console.log("  ✓ detected the step is complete — resuming.\n");
      await sleep(1500);
      return;
    }
    beats += 1;
    if (beats % 5 === 0) {
      console.log(`  …still waiting (${Math.round((deadline - Date.now()) / 1000)}s left). ${message}`);
    }
    await sleep(pollMs);
  }
  await screenshot("TIMEOUT-awaiting-human");
  throw new Error(`Timed out waiting for a human step: ${message}`);
}

/** Wait for the panel to show a live connection (after a supervised OAuth sign-in). */
export async function waitForConnected(message = "Complete the OAuth sign-in (and pick your environment) in the browser / quick pick.", timeoutMs = 10 * 60 * 1000): Promise<void> {
  await pauseForHuman(message, isConnected, { timeoutMs });
  console.log(`  Connected: ${await connectionSummary()}`);
}

/** Poll for a file the extension is expected to produce (scaffold, generated, build output). */
export async function waitForFileExists(filePath: string, timeoutMs = 300000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return true;
    }
    await sleep(2000);
  }
  return false;
}
