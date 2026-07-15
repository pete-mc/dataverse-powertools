import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import { freshWorkspace, answerText, answerFlexible, pickByLabel, resetAllCredentials, runCommand, dismissOverlays, sleep } from "../e2e/lib";
import { narrate, clickPanelButton, openPanelFrame, waitForConnected, isConnected, pauseForHuman, waitForFileExists, connectionSummary, actionBanner, expandComponentCards } from "./supervisedLib";

// REUSE mode (npm run test:supervised:reuse) skips the sign-in prompts and reuses the OAuth +
// pac profile captured on a prior fresh run, so fix iterations run unattended.
const reuse = process.env.DVPT_SUPERVISED_REUSE === "1";
const supervisedEnv = process.env.DVPT_SUPERVISED_ENV || ""; // environment name or org url to pick
const supervisedSolution = process.env.DVPT_SUPERVISED_SOLUTION || ""; // solution display name to pick

// ─────────────────────────────────────────────────────────────────────────────
// SUPERVISED plugin lifecycle → profiling/debug/trace.
//
// Run on demand: `npm run test:supervised`. NOT part of CI or `npm run test:e2e`.
// It drives the REAL panel buttons (not the command palette) and pauses for you at
// the sign-in steps. Watch the VS Code window; when you see the "🙋 ACTION NEEDED"
// banner in the terminal, do the step (sign in, enter the pac device code) and the
// test resumes itself once it detects you're done.
//
// v1 (this file) covers the first, most painful stretch — the OAuth + pac path:
//   clear → blank project → OAuth (your sign-in) → add Plugins → Generate Earlybound.
// The build → deploy → D365 → profile → debug → trace steps are the next slice.
// ─────────────────────────────────────────────────────────────────────────────

describe("SUPERVISED: plugin lifecycle (UI-only, human-assisted)", function () {
  // No mocha timeout — human steps take as long as they take (the harness has its
  // own generous per-step timeouts so it still fails cleanly if truly stuck).
  this.timeout(0);

  const componentFolder = "plugin"; // subfolder the Plugins component lives in
  const projectName = "SupervisedPlugin"; // pac plugin project name
  let workspace: string;

  /** All .csproj files anywhere under a directory (the v3 layout nests them). */
  function findCsproj(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory() && e.name !== "obj" && e.name !== "bin" && e.name !== "node_modules") {
          walk(full);
        } else if (e.isFile() && e.name.toLowerCase().endsWith(".csproj")) {
          out.push(full);
        }
      }
    };
    walk(dir);
    return out;
  }

  async function pollUntil(cond: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (cond()) {
        return true;
      }
      await sleep(2000);
    }
    return false;
  }

  before(async function () {
    workspace = freshWorkspace("supervised-plugin");
    console.log(`\n[supervised] workspace: ${workspace}`);
    await VSBrowser.instance.openResources(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
  });

  it("1) starts from a cleared auth + pac state (fresh mode only)", async function () {
    if (reuse) {
      console.log("  REUSE mode — keeping the captured OAuth + pac sign-in; skipping the clear.");
      this.skip();
      return;
    }
    await narrate("Clear stored credentials and any pac profile (fresh start)");
    // Setup prep (not a process under test): clear the extension's stored secrets +
    // token cache, and the extension-owned pac profile, so the sign-in is genuinely new.
    await resetAllCredentials((m) => console.log(`  ${m}`));
    try {
      await runCommand("Dataverse PowerTools: Clear pac Credentials");
      await sleep(800);
      // A modal confirm may appear — accept it.
      await pickByLabel("Clear", 8000).catch(() => undefined);
    } catch {
      /* command may be a no-op if nothing to clear */
    }
    // Prove the panel is in its disconnected "Get Started" state.
    const panel = await openPanelFrame();
    await panel.switchBack();
    expect(await isConnected(), "should start disconnected").to.equal(false);
  });

  it("2) creates a blank (multi-component) project from the panel button", async () => {
    // Click the REAL primary button, not the command palette.
    await clickPanelButton("Initialise Project", { timeoutMs: 30000 });
    await narrate("Wizard: choose a blank multi-component project");
    await pickByLabel("Multi-component project (two or more types)");
    await narrate("Wizard: choose interactive (OAuth) auth");
    await pickByLabel("OAuth");

    // The connection wizard (createServicePrincipalString) now runs its OAuth path:
    //   sign in → pick ENVIRONMENT → pick SOLUTION (prefix inferred) → project created.
    // FRESH mode: the sign-in opens the browser (you). REUSE mode: it's silent from the
    // captured cache. Either way we auto-answer the environment + solution picks from config,
    // so your only manual step is the browser sign-in itself.
    if (!reuse) {
      actionBanner("Sign in with OAuth in the browser that just opened — use the NEW account/profile you want. I'll drive the rest.");
    }
    await narrate(`Wizard: pick environment "${supervisedEnv}"`);
    await answerFlexible(supervisedEnv, reuse ? 180000 : 10 * 60 * 1000);
    await narrate(`Wizard: pick solution "${supervisedSolution}"`);
    // Next is the SOLUTION quick pick (prefix is then inferred from the chosen solution, so the
    // wizard finishes). If the solution list didn't load it falls back to a "schema name" input —
    // answerFlexible handles both, but a fallback here is itself a finding worth flagging.
    await answerFlexible(supervisedSolution, 120000);

    // Wizard done → settings written → panel refreshes to connected.
    expect(await waitForFileExists(path.join(workspace, "dataverse-powertools.json"), 120000), "dataverse-powertools.json created (wizard completed)").to.equal(true);
    await waitForConnected("Waiting for the panel to show the live connection.");
    console.log(`  Connected to: ${await connectionSummary()}`);
  });

  it("3) adds a Plugins component from the panel", async () => {
    await clickPanelButton("Add Component", { timeoutMs: 30000, contains: true }); // label is "＋ Add Component…"
    await narrate("Wizard: add a Plugins component");
    // Add Component has THREE prompts: component type → subfolder → plugin project name.
    await pickByLabel("Plugins"); // 1) component type
    await answerText(componentFolder); // 2) subfolder (defaults to "plugin")
    await answerText(projectName); // 3) plugin project name (defaults to "Plugin")
    // pac plugin init + restore run here (local — no auth). Gate on the scaffold appearing; add
    // Component does NOT prompt for unit-testing/create-class (that's the new-project flow), so
    // don't wait for phantom prompts. The v3 layout nests the csproj under the subfolder.
    await narrate("Waiting for pac plugin init + restore (local, no sign-in)");
    const componentRoot = path.join(workspace, componentFolder);
    const found = await pollUntil(() => findCsproj(componentRoot).length > 0, 300000);
    await dismissOverlays(); // clear any non-blocking "component added" notification
    expect(found, `a .csproj scaffolded under ${componentFolder}/`).to.equal(true);
    console.log(`  Scaffolded: ${findCsproj(componentRoot).join(", ")}`);
  });

  it("4) generates early-bound classes from the panel — the OAuth pac path (#128/#129, 0.14.1)", async () => {
    // Multi-component cards open collapsed (#156) — expand so the plugin card's actions show.
    await expandComponentCards();
    // THIS is the step that exercises pac under OAuth: it establishes/reuses the
    // extension-owned `dataverse-powertools` pac profile via device code, then runs
    // `pac modelbuilder`. If it can't find/create the profile, this is where the old
    // bug bit — the whole point of watching this run.
    await clickPanelButton("Generate Earlybound", { timeoutMs: 30000 });

    // First pac use under OAuth → device-code sign-in. The extension shows the code in a
    // notification + the output channel. Complete it; the test resumes when generated files appear.
    const generatedDir = path.join(workspace, "generated");
    await pauseForHuman(
      "If prompted, complete the pac DEVICE-CODE sign-in (the code is in the notification / Dataverse PowerTools output). I'll continue when early-bound files appear under generated/.",
      async () => {
        try {
          return fs.existsSync(generatedDir) && fs.readdirSync(generatedDir).some((f) => f.toLowerCase().endsWith(".cs"));
        } catch {
          return false;
        }
      },
      { timeoutMs: 12 * 60 * 1000 },
    );

    await narrate("Early-bound generation complete");
    const hasGenerated = fs.existsSync(generatedDir) && fs.readdirSync(generatedDir).some((f) => f.toLowerCase().endsWith(".cs"));
    expect(hasGenerated, "generated/*.cs produced by pac modelbuilder under OAuth").to.equal(true);
  });

  after(async function () {
    await narrate("v1 stretch complete — connected + plugin + early-bound under OAuth");
    console.log("\n[supervised] Next slice: build → deploy → trigger in D365 → profile a step → debug (breakpoint) → trace log.\n");
  });
});
