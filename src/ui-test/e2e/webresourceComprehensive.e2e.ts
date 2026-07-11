import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import {
  loadE2EEnv,
  freshWorkspace,
  answerText,
  answerFlexible,
  pickByLabel,
  pickExactLabel,
  pickFirst,
  runCommand,
  waitForFile,
  expectOutput,
  clearOutput,
  dismissOverlays,
  sleep,
  E2EClient,
} from "./lib";
import { signInFreshBrowser, autoLoginWithRetry, bannerOnForm, bannerAfterReload, findDebugPortByProfile, killBrowsersByProfile, killStaleE2EProcesses } from "./browserLib";
import { resolveBrowser } from "../../webresources/debug/browserResolver";

// COMPREHENSIVE end-to-end webresource journey — every step driven through the REAL VS Code UI,
// no backend shortcuts, and each step GATED on the extension's own log line before advancing (a
// wrong/missing line stops the run via expectOutput). Mirrors what a developer actually does:
//
//   1. Initialise a clean Web Resources project (wizard, service-principal auth)
//   2. Generate typings           (bundled net8 tool — validates #78/#91 through the UI)
//   3. Create a class + test with a form registration
//   4. Build the webresource      (webpack)
//   5. Build & deploy to Dataverse
//   6. Register form events        (push the onload handler to the form)
//   7. Open the live app in a browser and confirm the DEPLOYED code runs on the form
//   8. Debug Web Resources locally + edit the source and confirm HOT RELOAD
//
// Steps 1-6 always run (given sandbox/.env). Steps 7-8 additionally need the MFA-exempt interactive
// user (DVPT_TEST_USERNAME/PASSWORD) to sign the browser in, and self-skip without it.
describe("Web resources — comprehensive UI lifecycle (e2e)", function () {
  this.timeout(30 * 60 * 1000);
  const env = loadE2EEnv();
  const hasBrowserUser = !!(env?.username && env?.password);
  const className = "E2ECompre";
  const entity = "account";
  const entitySet = "accounts";
  const primaryId = "accountid";

  let workspace: string;
  let solutionFriendlyName: string;
  let formId = "";
  let recordUrl = "";
  const orgHost = env ? new URL(env.url).host : "";
  const classFile = () => path.join(workspace, "webresources_src", `${className}.ts`);

  function libraryName(): string {
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8"));
      return `${settings.prefix}_library.js`;
    } catch {
      return `${env?.prefix}_library.js`;
    }
  }

  // The scaffolded class renders `setFormNotification("<class> loaded", ...)` onload — our
  // detectable signal. Step 8 rewrites "loaded" -> "HOTRELOAD" to prove the local build hot-reloads.
  const loadedBanner = `${className} loaded`;
  const reloadBanner = `${className} HOTRELOAD`;

  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      try {
        const dir = path.resolve(__dirname, "..", "..", "..", "sandbox", "screenshots-out");
        fs.mkdirSync(dir, { recursive: true });
        const img = await VSBrowser.instance.driver.takeScreenshot();
        const name = (this.currentTest?.title || "step").replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
        fs.writeFileSync(path.join(dir, `e2e-wr-comprehensive-${name}.png`), img, "base64");
      } catch {
        /* ignore */
      }
    }
  });

  before(async function () {
    if (!env) {
      this.skip();
    }
    // Start from a clean slate: reap orphan webpack watchers / debug browsers left by any crashed
    // prior run so this run has full memory headroom (an OOM'd VS Code host kills the whole suite).
    killStaleE2EProcesses();
    const client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;

    workspace = freshWorkspace("webresource-comprehensive");
    await VSBrowser.instance.openResources(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    try {
      await runCommand("Dataverse PowerTools: Show Log");
    } catch {
      /* the command may not be registered until the extension activates */
    }
  });

  const log = (m: string) => console.log(`    [e2e] ${m}`);

  it("1. initialises a clean Web Resources project via the wizard", async () => {
    log("Initialise Project");
    await runCommand("Dataverse PowerTools: Initialise Project");
    await pickByLabel("Web Resources");
    await pickByLabel("Service principal (client secret)");
    await answerText(env!.tenantId);
    await answerText(env!.clientId);
    await answerText(env!.clientSecret);
    await answerFlexible(env!.url);
    await pickByLabel(solutionFriendlyName);
    log("output mode prompt");
    await pickByLabel("Single bundled library (recommended)", 600000); // output mode (#88) — restores run first
    log("waiting for restore + create-webresource prompt");
    await pickByLabel("No", 600000); // "create a new webresource?" — npm restore runs first
    await sleep(4000);
    await dismissOverlays();

    expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 60000), "dataverse-powertools.json").to.equal(true);
    // #78: the old Windows-only nuget XrmDefinitelyTyped.exe must NOT be restored any more.
    expect(fs.existsSync(path.join(workspace, "packages", "Delegate.XrmDefinitelyTyped")), "old XrmDefinitelyTyped nuget should be gone").to.equal(false);
  });

  it("2. generates typings via the bundled net8 tool (gated on the log)", async () => {
    await clearOutput();
    await runCommand("Dataverse PowerTools: Generate Typings");
    // STOP if the log doesn't report success (or reports a failure) — don't advance blind.
    await expectOutput("Typings have been generated.", { timeoutMs: 300000, step: "generate typings" });
    expect(await waitForFile(path.join(workspace, "typings", "XRM"), 30000), "typings/XRM").to.equal(true);
  });

  it("3. creates a class + test with a form registration", async () => {
    await runCommand("Dataverse PowerTools: Create Web Resource Class");
    await answerText(className); // class name
    await pickExactLabel(entity, 60000); // table (exact "account")
    await pickFirst(60000); // form (first available) — its formId is written into the class file
    await pickByLabel("Yes", 60000); // create test?
    await sleep(3000);
    await dismissOverlays();

    expect(await waitForFile(classFile(), 30000), `${className}.ts`).to.equal(true);
    expect(await waitForFile(path.join(workspace, "webresources_src", "__tests__", `${className}.test.ts`), 30000), `${className}.test.ts`).to.equal(true);

    // Capture the real formId the wizard wrote, for the browser steps.
    const src = fs.readFileSync(classFile(), "utf8");
    formId = (src.match(/formId:\s*"([0-9a-fA-F-]{36})"/)?.[1] ?? "").toLowerCase();
    expect(formId, "formId embedded in the class file").to.match(/^[0-9a-f-]{36}$/);
    log(`class registered on ${entity} form ${formId}`);
  });

  it("4. builds the webresource (gated on the log)", async () => {
    await clearOutput();
    await runCommand("Dataverse PowerTools: Build Webresources");
    await expectOutput("Building Complete", { timeoutMs: 180000, step: "build" });
    expect(await waitForFile(path.join(workspace, "bin", libraryName()), 30000), `bin/${libraryName()}`).to.equal(true);
  });

  it("5. builds & deploys to Dataverse (gated on the log)", async () => {
    await clearOutput();
    await runCommand("Dataverse PowerTools: Build and Deploy Webresources");
    await expectOutput("Webresource deployment complete", { timeoutMs: 180000, step: "deploy" });
    await dismissOverlays();

    const client = new E2EClient(env!);
    await client.connect();
    let id: string | undefined;
    const deadline = Date.now() + 90000;
    do {
      try {
        id = await client.findWebresourceId(libraryName());
      } catch {
        id = undefined;
      }
      if (id) {
        break;
      }
      await sleep(5000);
    } while (Date.now() < deadline);
    expect(id, `${libraryName()} exists in Dataverse`).to.not.equal(undefined);
  });

  it("6. registers the form events (gated on the log)", async () => {
    await clearOutput();
    await runCommand("Dataverse PowerTools: Register Form Events");
    // saveFormData logs Saving Forms... -> Publishing All Customisations -> Publish Complete.
    await expectOutput("Publish Complete", { timeoutMs: 180000, step: "register form events" });
    // PublishAllXml returns before the app fully serves the updated form; let it settle.
    await sleep(15000);
  });

  it("7. opens the live app in a browser and confirms the DEPLOYED code runs on the form", async function () {
    if (!hasBrowserUser) {
      log("no interactive user (DVPT_TEST_USERNAME/PASSWORD) — skipping browser verification");
      this.skip();
    }
    const client = new E2EClient(env!);
    await client.connect();
    const appId = await client.getModelDrivenAppId();
    const recordId = await client.getFirstRecordId(entitySet, primaryId);
    // Force the specific form we registered on (&formid=) — the app otherwise opens the user's
    // last-used form. Open a real record (a create form triggers a beforeunload dialog on reload).
    recordUrl = `${env!.url.replace(/\/+$/, "")}/main.aspx?${appId ? `appid=${appId}&` : ""}pagetype=entityrecord&etn=${entity}&formid=${formId}${recordId ? `&id=${recordId}` : ""}`;
    log(`record url: ${recordUrl}`);

    const resolved = resolveBrowser("auto", undefined, { platform: process.platform, env: process.env, exists: fs.existsSync });
    const profileDir = path.join(os.tmpdir(), "dvpt-e2e-browser", "verify-deployed");
    // Relaunch a fresh browser per attempt (a wedged AAD page sits loading and re-navigating won't
    // recover it).
    const { browser, signedIn } = await signInFreshBrowser(resolved.executablePath, profileDir, env!.url, {
      username: env!.username!,
      password: env!.password!,
      orgHost,
      log,
      timeoutMs: 75000,
    });
    try {
      expect(signedIn, "browser reached the org").to.equal(true);
      const banner = await bannerOnForm(browser.port, recordUrl, [loadedBanner, reloadBanner], loadedBanner);
      log(`deployed banner: ${banner}`);
      expect(banner, "deployed webresource rendered its onload notification").to.contain(loadedBanner);
    } finally {
      // Fully tear down this browser (tree, not just the launcher shim) and let it settle — a
      // lingering Edge instance makes step 8's debug-browser launch delegate to it, so the
      // port-bearing process exits and the debug port can't be discovered.
      browser.kill();
      killBrowsersByProfile("verify-deployed");
      await sleep(5000);
    }
  });

  it("8. debugs the webresource locally and hot-reloads on edit (via the UI)", async function () {
    if (!hasBrowserUser) {
      this.skip();
    }
    if (!recordUrl) {
      throw new Error("step 7 did not establish the record URL — cannot run the debug step");
    }

    // Kill any stale debug browser from a prior run first — otherwise the new launch delegates to
    // it (same profile dir) and the fresh, port-bearing process exits, so the port can't be found.
    killBrowsersByProfile("webresource-debug-profile");
    await sleep(2000);

    await clearOutput();
    log("Debug Web Resources (launches a browser + serves the local bundle)");
    await runCommand("Dataverse PowerTools: Debug Web Resources (serve local build into the live app)");
    const startText = await expectOutput("Web Resources debug session started", { timeoutMs: 120000, step: "debug start" });

    // Read the debug browser's DevTools port straight from the extension's own log — unambiguous,
    // unlike scanning browser processes (which can pick up step 7's leftover browser). Fall back to
    // the CDP scan only if the line is somehow absent.
    let port = Number(startText.match(/\[debug\] DevTools endpoint on port (\d+)/)?.[1]);
    if (!port) {
      port = await findDebugPortByProfile("webresource-debug-profile", 60000, log);
    }
    log(`debug browser on port ${port}`);
    const signedIn = await autoLoginWithRetry(port, env!.url, { username: env!.username!, password: env!.password!, orgHost, log, timeoutMs: 80000 });
    expect(signedIn, "debug browser reached the org").to.equal(true);

    // Let the debug session's webpack --watch finish its initial rebuild + the Fetch interception
    // arm before we open the form, so it serves a complete local bundle (not a mid-build one).
    await sleep(12000);

    // Navigating the form triggers the feature's Fetch interception to serve the LOCAL bundle.
    const first = await bannerOnForm(port, recordUrl, [loadedBanner, reloadBanner], loadedBanner, 90000, log);
    log(`local banner on first load: ${first}`);
    await expectOutput("[debug] served local", { timeoutMs: 60000, step: "debug serve local" });
    expect(first, "local bundle served onto the form").to.contain(loadedBanner);

    // Edit the source — webpack --watch rebuilds and the feature hot-reloads the page.
    log("editing the class to force a hot reload");
    const src = fs.readFileSync(classFile(), "utf8");
    fs.writeFileSync(classFile(), src.replace(loadedBanner, reloadBanner));
    await expectOutput("[debug] bundle rebuilt — reloading", { timeoutMs: 120000, step: "hot reload build" });

    const after = await bannerAfterReload(port, [loadedBanner, reloadBanner], reloadBanner);
    log(`banner after edit: ${after}`);
    expect(after, "form hot-reloaded to the edited banner").to.contain(reloadBanner);

    await clearOutput();
    await runCommand("Dataverse PowerTools: Stop Debugging Web Resources");
    await expectOutput("Web Resources debug session stopped", { timeoutMs: 30000, step: "debug stop" });
  });

  after(async function () {
    if (!env) {
      return;
    }
    try {
      await runCommand("Dataverse PowerTools: Stop Debugging Web Resources");
    } catch {
      /* no active session */
    }
    const client = new E2EClient(env);
    await client.connect();
    await client.deleteWebresource(libraryName());
  });
});
