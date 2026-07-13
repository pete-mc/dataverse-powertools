import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import {
  loadE2EEnv,
  freshWorkspace,
  answerText,
  answerFlexible,
  pickByLabel,
  runCommand,
  runCommandResilient,
  waitForFile,
  waitForOutput,
  dismissOverlays,
  sleep,
  E2EClient,
} from "./lib";
import { resetAllCredentials } from "./lib";

// End-to-end for the BLANK (connection-only) root + Add Component (user request):
// initialise an "Empty (components in subfolders)" workspace, then add TWO
// components of EVERY other type into subfolders. Each component's settings file
// must carry its type but NO connection (it inherits the root's); the root file
// must stay typeless with the connection. Scaffold + restore per type is proven
// by a marker file (plugin's is the pac-init csproj, so its restore path runs).
// With two web-resource components present, a webresources command must target
// the ONE the user picks (runForComponent's picker) and scope its write to it —
// the UI-level proof of #119 command targeting the headless monorepo spec models.
describe("Blank root + two components of each type (e2e)", function () {
  this.timeout(1500000);
  const env = loadE2EEnv();
  let workspace: string;
  let solutionFriendlyName: string;

  function readSettings(relative: string): any {
    return JSON.parse(fs.readFileSync(path.join(workspace, relative, "dataverse-powertools.json"), "utf8"));
  }

  /** Poll a component's settings until a predicate holds (a command's write landed). */
  async function waitForSettings(relative: string, predicate: (settings: any) => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        if (predicate(readSettings(relative))) {
          return true;
        }
      } catch {
        /* file mid-write — retry */
      }
      if (Date.now() > deadline) {
        return false;
      }
      await sleep(2000);
    }
  }

  /** Gate on the Add Component command FULLY completing. Its last step logs
   * "[Components] N components discovered"; without waiting for it the test returns
   * as soon as the npm/paket lockfile appears (mid-add), so mocha starts the NEXT
   * add while this one is still restoring + discovering — the two scaffolds then
   * overlap (doubled restore/discovery output). `count` = components after this add
   * (the connection-only root + every component added so far). */
  async function waitForAddComplete(count: number): Promise<void> {
    const seen = await waitForOutput(`${count} components discovered`, 180000);
    expect(seen, `Add Component finished (discovery logged ${count} components)`).to.not.equal(undefined);
    await sleep(3000); // let the post-discovery tail (initialise + panel refresh) settle
  }

  /** Read visible notification text from the DOM. Must run BEFORE dismissOverlays (which
   * wipes toasts) so a command-error notification can be asserted. A command that throws
   * shows "Command '…' resulted in an error" — e.g. the duplicate-TestController crash a
   * second same-type component used to trigger (#47). */
  async function assertCommandDidNotError(context: string): Promise<void> {
    await sleep(6000); // let the command settle so any error notification has surfaced
    let text = "";
    try {
      text = String(
        (await VSBrowser.instance.driver.executeScript(
          "return Array.from(document.querySelectorAll('.notification-list-item-message, .notification-toast, .monaco-dialog-box')).map(function(e){return e.textContent || '';}).join(' ||| ');",
        )) ?? "",
      );
    } catch {
      /* no notifications surface readable */
    }
    expect(/resulted in an error/i.test(text), `${context}: a command surfaced an error notification — "${text.slice(0, 300)}"`).to.equal(false);
  }

  /** Clear the active editor so runForComponent falls to its picker (not active-editor inference). */
  async function closeAllEditors(): Promise<void> {
    try {
      await runCommand("View: Close All Editors");
    } catch {
      /* nothing open */
    }
    await sleep(1000);
    await dismissOverlays();
  }

  /** Poll for any file matching a predicate under a folder (recursive). */
  async function waitForMatch(root: string, matches: (file: string) => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const scan = (dir: string): boolean => {
      if (!fs.existsSync(dir)) {
        return false;
      }
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules") {
          if (scan(full)) {
            return true;
          }
        } else if (matches(entry.name)) {
          return true;
        }
      }
      return false;
    };
    for (;;) {
      if (scan(root)) {
        return true;
      }
      if (Date.now() > deadline) {
        return false;
      }
      await sleep(3000);
    }
  }

  /** Open Add Component and land on the type pick — retries once, because the
   * PREVIOUS component's restore progress/toast can swallow the first attempt
   * (the Solution/Portal adds timed out exactly there on the first gate run). */
  async function startAddComponent(typeLabel: string): Promise<void> {
    await sleep(8000); // let the previous add's notifications settle
    await dismissOverlays();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await runCommand("Dataverse PowerTools: Add Component");
        await pickByLabel(typeLabel, 30000);
        return;
      } catch (err) {
        if (attempt === 1) {
          throw err;
        }
        await dismissOverlays();
        await sleep(5000);
      }
    }
  }

  before(async function () {
    if (!env) {
      this.skip();
    }
    const client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;

    workspace = freshWorkspace("blank-root");
    await VSBrowser.instance.openResources(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    try {
      await runCommand("Dataverse PowerTools: Show Log");
    } catch {
      /* not registered until activation */
    }
  });

  it("initialises a connection-only (blank) root via the wizard", async () => {
    const log = (m: string) => console.log(`    [e2e] ${m}`);
    log("running Initialise Project");
    await resetAllCredentials(log);
    await runCommand("Dataverse PowerTools: Initialise Project");
    log("project type: Empty");
    await pickByLabel("Empty (components in subfolders)");
    log("auth type");
    await pickByLabel("Service principal (client secret)");
    await answerText(env!.tenantId);
    await answerText(env!.clientId);
    await answerText(env!.clientSecret);
    log("environment");
    await answerFlexible(env!.url);
    log(`solution (${solutionFriendlyName})`);
    await pickByLabel(solutionFriendlyName);
    await sleep(5000);
    await dismissOverlays();

    expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 120000), "root dataverse-powertools.json").to.equal(true);
    const settings = readSettings(".");
    expect(settings.type, "blank root has NO project type").to.equal(undefined);
    expect(settings.connectionString, "blank root carries the connection").to.be.a("string").and.not.equal("");
  });

  it("adds a Web Resources component into a subfolder", async () => {
    await startAddComponent("Web Resources");
    await answerText("webresources"); // subfolder (the suggested default)
    // Scaffold + npm install run behind a progress notification — poll the outputs.
    expect(await waitForFile(path.join(workspace, "webresources", "dataverse-powertools.json"), 600000), "webresources settings").to.equal(true);
    expect(await waitForFile(path.join(workspace, "webresources", "webpack.common.js"), 60000), "webresources scaffold").to.equal(true);
    // Gate on npm install COMPLETING so the next add starts with a quiet UI.
    expect(await waitForFile(path.join(workspace, "webresources", "node_modules", ".package-lock.json"), 600000), "npm install finished").to.equal(true);
    const settings = readSettings("webresources");
    expect(settings.type).to.equal("webresources");
    expect(settings.connectionString, "component inherits the root connection — no own connectionString").to.equal(undefined);
    // Template substitution must run at Add-Component time (the component carries the
    // inherited prefix): webpack.common.js has the real prefix, not the literal token.
    const webpackCommon = fs.readFileSync(path.join(workspace, "webresources", "webpack.common.js"), "utf8");
    expect(webpackCommon, "SOLUTIONPREFIX token substituted").to.not.contain("SOLUTIONPREFIX");
    expect(settings.prefix, "component carries the inherited publisher prefix").to.be.a("string").and.not.equal("");
    expect(webpackCommon, "webpack.common.js uses the real prefix").to.contain(`${settings.prefix}_library.js`);
    await waitForAddComplete(2); // root + webresources — don't let the next add overlap
  });

  it("adds a SECOND Web Resources component into a distinct subfolder", async () => {
    await startAddComponent("Web Resources");
    await answerText("webresources2"); // a second web-resource component alongside the first
    expect(await waitForFile(path.join(workspace, "webresources2", "dataverse-powertools.json"), 600000), "webresources2 settings").to.equal(true);
    expect(await waitForFile(path.join(workspace, "webresources2", "webpack.common.js"), 60000), "webresources2 scaffold").to.equal(true);
    expect(await waitForFile(path.join(workspace, "webresources2", "node_modules", ".package-lock.json"), 600000), "npm install finished").to.equal(true);
    const settings = readSettings("webresources2");
    expect(settings.type).to.equal("webresources");
    expect(settings.connectionString, "second component also inherits the root connection").to.equal(undefined);
    const webpackCommon = fs.readFileSync(path.join(workspace, "webresources2", "webpack.common.js"), "utf8");
    expect(webpackCommon, "SOLUTIONPREFIX substituted in the second component too").to.not.contain("SOLUTIONPREFIX");
    expect(webpackCommon).to.contain(`${settings.prefix}_library.js`);
    await waitForAddComplete(3); // root + webresources + webresources2
    // The second web-resource component's Test Explorer controller must get a distinct id —
    // a duplicate id makes Add Component throw "duplicate controller with ID" (#47).
    await assertCommandDidNotError("second Web Resources add");
  });

  it("a webresources command targets the component the user picks (two present) and scopes its write", async () => {
    // Two web-resource components now exist. With no active editor, runForComponent must
    // ask which one; picking webresources2 scopes Switch Output Mode's settings write to it
    // alone — the first component's settings must be untouched. This is the UI-level #119 proof.
    await closeAllEditors();
    await dismissOverlays();
    await runCommandResilient("Dataverse PowerTools: Switch Web Resource Output Mode");
    // Select by keyboard (type-to-filter + Enter), NOT a coordinate click: closing all
    // editors reveals the empty-editor watermark, whose keybinding-hint <p> elements sit
    // over the quick-pick rows and intercept clicks (ElementClickInterceptedError).
    await answerText("webresources2"); // the "Which component?" picker → filters to the one, Enter selects
    await answerText("One file per web resource"); // the mode picker
    expect(await waitForSettings("webresources2", (s) => s.webresourceOutput === "perFile", 30000), "webresources2 switched to perFile").to.equal(true);
    expect(readSettings("webresources").webresourceOutput, "the FIRST component's output mode is untouched").to.not.equal("perFile");
  });

  it("adds a Plugins component into a subfolder (pac init + restore)", async () => {
    await startAddComponent("Plugins");
    await answerText("plugin"); // subfolder
    await answerText("E2EBlankPlugin"); // plugin project name
    expect(await waitForFile(path.join(workspace, "plugin", "dataverse-powertools.json"), 600000), "plugin settings").to.equal(true);
    expect(await waitForMatch(path.join(workspace, "plugin"), (file) => file.endsWith(".csproj"), 600000), "a csproj scaffolded by pac plugin init").to.equal(true);
    // Layout normalisation must have produced the .sln (MSB1003 regression — the
    // final dotnet restore needs it) and the restore must have COMPLETED
    // (project.assets.json) before the next add begins.
    expect(await waitForMatch(path.join(workspace, "plugin"), (file) => file.endsWith(".sln"), 300000), "normalised layout (.sln)").to.equal(true);
    expect(await waitForMatch(path.join(workspace, "plugin"), (file) => file === "project.assets.json", 600000), "dotnet restore finished").to.equal(true);
    const settings = readSettings("plugin");
    expect(settings.type).to.equal("plugin");
    expect(settings.pluginProjectName).to.equal("E2EBlankPlugin");
    expect(settings.connectionString).to.equal(undefined);
    await waitForAddComplete(4); // root + 2 webresources + plugin
  });

  it("adds a SECOND Plugins component into a distinct subfolder (own project scaffold)", async () => {
    await startAddComponent("Plugins");
    await answerText("plugin2"); // second plugin component alongside the first
    await answerText("E2EBlankPlugin2"); // distinct plugin project name
    expect(await waitForFile(path.join(workspace, "plugin2", "dataverse-powertools.json"), 600000), "plugin2 settings").to.equal(true);
    expect(await waitForMatch(path.join(workspace, "plugin2"), (file) => file.endsWith(".csproj"), 600000), "plugin2 csproj scaffolded").to.equal(true);
    expect(await waitForMatch(path.join(workspace, "plugin2"), (file) => file.endsWith(".sln"), 300000), "plugin2 normalised layout (.sln)").to.equal(true);
    expect(await waitForMatch(path.join(workspace, "plugin2"), (file) => file === "project.assets.json", 600000), "plugin2 dotnet restore finished").to.equal(true);
    const settings = readSettings("plugin2");
    expect(settings.type).to.equal("plugin");
    expect(settings.pluginProjectName, "second plugin keeps its own project name").to.equal("E2EBlankPlugin2");
    expect(settings.connectionString).to.equal(undefined);
    await waitForAddComplete(5); // root + 2 webresources + 2 plugins
    // Same duplicate-controller guard for the plugin Test Explorer controller (#47).
    await assertCommandDidNotError("second Plugins add");
  });

  it("adds a Solution component into a subfolder", async () => {
    await startAddComponent("Solution");
    await answerText("solution"); // subfolder
    expect(await waitForFile(path.join(workspace, "solution", "dataverse-powertools.json"), 600000), "solution settings").to.equal(true);
    expect(await waitForFile(path.join(workspace, "solution", "nuget.config"), 120000), "solution scaffold").to.equal(true);
    // The solution restore chain ends with paket install — gate on its lock file.
    expect(await waitForFile(path.join(workspace, "solution", "paket.lock"), 600000), "paket install finished").to.equal(true);
    const settings = readSettings("solution");
    expect(settings.type).to.equal("solution");
    expect(settings.templateversion, "integer template version (1.1 float retired, #71)").to.equal(2);
    expect(settings.connectionString).to.equal(undefined);
    await waitForAddComplete(6); // root + 2 webresources + 2 plugins + solution
  });

  it("adds a SECOND Solution component into a distinct subfolder", async () => {
    await startAddComponent("Solution");
    await answerText("solution2"); // second solution component alongside the first
    expect(await waitForFile(path.join(workspace, "solution2", "dataverse-powertools.json"), 600000), "solution2 settings").to.equal(true);
    expect(await waitForFile(path.join(workspace, "solution2", "nuget.config"), 120000), "solution2 scaffold").to.equal(true);
    expect(await waitForFile(path.join(workspace, "solution2", "paket.lock"), 600000), "solution2 paket install finished").to.equal(true);
    const settings = readSettings("solution2");
    expect(settings.type).to.equal("solution");
    expect(settings.connectionString).to.equal(undefined);
    await waitForAddComplete(7); // root + 2 webresources + 2 plugins + 2 solutions
  });

  it("adds a Portal component into a subfolder", async () => {
    await startAddComponent("Portal");
    await answerText("portal"); // subfolder
    expect(await waitForFile(path.join(workspace, "portal", "dataverse-powertools.json"), 300000), "portal settings").to.equal(true);
    const settings = readSettings("portal");
    expect(settings.type).to.equal("portal");
    expect(settings.connectionString).to.equal(undefined);
    await waitForAddComplete(8); // root + 2 webresources + 2 plugins + 2 solutions + portal
  });

  it("adds a SECOND Portal component into a distinct subfolder", async () => {
    await startAddComponent("Portal");
    await answerText("portal2"); // second portal component alongside the first
    expect(await waitForFile(path.join(workspace, "portal2", "dataverse-powertools.json"), 300000), "portal2 settings").to.equal(true);
    const settings = readSettings("portal2");
    expect(settings.type).to.equal("portal");
    expect(settings.connectionString).to.equal(undefined);
    await waitForAddComplete(9); // root + two of every type
  });

  it("root stays a typeless connection-only file after all additions", async () => {
    const settings = readSettings(".");
    expect(settings.type).to.equal(undefined);
    expect(settings.connectionString).to.be.a("string").and.not.equal("");
    // Eight components discovered off the root: two of every type, each type-scoped, none owning a connection.
    for (const rel of ["webresources", "webresources2", "plugin", "plugin2", "solution", "solution2", "portal", "portal2"]) {
      expect(readSettings(rel).connectionString, `${rel} inherits (owns no connection)`).to.equal(undefined);
    }
  });
});
