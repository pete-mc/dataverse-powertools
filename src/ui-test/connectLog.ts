import * as path from "path";
import * as fs from "fs";
import { VSBrowser, Workbench, InputBox } from "vscode-extension-tester";

// Local generator (NOT a .test.ts, so not in the CI glob). Connects to the REAL test
// environment via the service-principal wizard (headless — no browser), deploys the
// bin/dvpt_library.js webresource bundle, then opens the Dataverse PowerTools output
// channel and screenshots it — real logs, real connection. Reads creds from the
// gitignored sandbox/.env; skips if absent.
const repoRoot = path.resolve(__dirname, "..", "..");
const outDir = path.resolve(repoRoot, "sandbox", "screenshots-out");
const fixture = path.resolve(repoRoot, "sandbox", "screens", "connect");

function loadEnv(): Record<string, string> {
  const p = path.resolve(repoRoot, "sandbox", ".env");
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) {
    return out;
  }
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) {
      continue;
    }
    const i = t.indexOf("=");
    if (i > 0) {
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

// Answer the next wizard step: select from a quick pick (by label, or the first item)
// or type into an input box and confirm.
async function answer(value: string, byLabel = false): Promise<void> {
  const input = await InputBox.create(25000);
  let picks: unknown[] = [];
  try {
    picks = await input.getQuickPicks();
  } catch {
    picks = [];
  }
  if (picks.length > 0) {
    await input.selectQuickPick(byLabel ? value : 0);
  } else {
    await input.setText(value);
    await input.confirm();
  }
  await sleep(2500);
}

describe("Dataverse PowerTools connect + log", function () {
  this.timeout(300000);
  const env = loadEnv();

  before(async function () {
    if (!env.DVPT_TEST_CLIENT_ID || !fs.existsSync(fixture)) {
      this.skip();
    }
    fs.mkdirSync(outDir, { recursive: true });
    await VSBrowser.instance.openResources(fixture);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
  });

  it("connects with real creds, deploys a webresource, and captures the log", async () => {
    // readSettings triggers the connection wizard on load (client secret, no stored secret).
    await answer("Service principal (client secret)", true);
    await answer(env.DVPT_TEST_TENANT_ID);
    await answer(env.DVPT_TEST_CLIENT_ID);
    await answer(env.DVPT_TEST_CLIENT_SECRET);
    await answer(env.DVPT_TEST_URL); // environment pick (or manual url)
    await answer(env.DVPT_TEST_SOLUTION_NAME || "dvpttests"); // solution pick (or manual)
    await sleep(6000);
    await dismissOverlays();

    await new Workbench().executeCommand("Dataverse PowerTools: Show Log");
    await sleep(3000);
    const img = await VSBrowser.instance.driver.takeScreenshot();
    fs.writeFileSync(path.join(outDir, "connect-log.png"), img, "base64");
  });
});
