import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import {
  openWorkspaceFolder,
  loadE2EEnv,
  freshWorkspace,
  answerText,
  pickByLabel,
  pickFirst,
  waitForFile,
  dismissOverlays,
  sleep,
  E2EClient,
  waitForLogFile,
  logFileSize,
} from "./lib";
import { clickPanelButton, clickOverflowItem, expandComponentCards } from "../supervised/supervisedLib";
import { initProject, step, showLog } from "./acceptanceLib";

// ACCEPTANCE (button-driven, live Dataverse): the real main process for a Web Resources project —
// start the project, write a TypeScript class bound to a form (the form-event registration),
// build the bundle, then deploy it (which registers the form event + uploads), and verify the
// web resource landed in Dataverse. All via the panel's own buttons + overflow menu.
const COMPONENT = "Web Resource";

describe("ACCEPTANCE: Web Resource — build, code, register, publish via panel buttons", function () {
  this.timeout(2400000);
  const env = loadE2EEnv();
  let workspace: string;
  let solutionFriendlyName: string;
  let client: E2EClient;
  const className = "AcceptanceWebResource";

  function libraryName(): string {
    const settings = JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8"));
    return `${settings.prefix ?? env?.prefix}_library.js`;
  }

  before(async function () {
    if (!env) {
      this.skip();
    }
    client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;
    workspace = freshWorkspace("acc-webresource");
    await openWorkspaceFolder(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    await showLog();
  });

  it("starts a Web Resources project (Initialise button + wizard)", async () => {
    await step(COMPONENT, "Start project (Initialise button)", async () => {
      await initProject("Web Resources", env!, solutionFriendlyName, async () => {
        await pickByLabel("Single bundled library (recommended)", 600000); // output mode (restores run first)
        await pickByLabel("No", 600000); // "create a new webresource?" — restores + typings run first
      });
      expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 300000), "project scaffolded").to.equal(true);
      return "Web Resources project scaffolded + connected (service principal)";
    });
  });

  it("writes a class bound to a form (New class overflow) — code + form-event registration", async () => {
    await step(COMPONENT, "Write code + register (New class bound to a form)", async () => {
      await clickOverflowItem("New class", { timeoutMs: 45000 });
      await answerText(className); // 1: class name
      await pickFirst(60000); // 2: table (first available)
      await pickFirst(60000); // 3: form (first available) — this is the form-event registration
      await pickByLabel("Yes", 60000); // 4: create a test?
      await sleep(3000);
      await dismissOverlays();
      const ts = path.join(workspace, "webresources_src", `${className}.ts`);
      expect(await waitForFile(ts, 60000), "class file").to.equal(true);
      return `wrote webresources_src/${className}.ts, bound to a form (RegisterEvent decoration)`;
    });
  });

  it("builds the bundle — Local Build button", async () => {
    await step(COMPONENT, "Build (Local Build button → webpack)", async () => {
      await expandComponentCards();
      await clickPanelButton("Local Build", { timeoutMs: 30000 });
      expect(await waitForFile(path.join(workspace, "bin", libraryName()), 240000), `bin/${libraryName()}`).to.equal(true);
      return `webpack bundled bin/${libraryName()}`;
    });
  });

  it("registers the form event + publishes — Deploy button; verified in Dataverse", async () => {
    await step(COMPONENT, "Register form event + publish (Deploy)", async () => {
      await expandComponentCards();
      // Remove any same-named leftover FIRST. Every web-resource suite deploys the same single-bundle
      // name (`{prefix}_library.js`), so without this the poll below is satisfied by ANOTHER suite's
      // web resource — it passed instantly, the suite ended while this deploy's webpack child was still
      // running, ExTester killed it, and the orphaned child logged `Build failed: Command failed: npx
      // webpack` after the last assertion. That bogus failure signature was #249; the hollow assertion
      // was its cause. Now the resource can only be found because THIS deploy uploaded it.
      await client.deleteWebresource(libraryName()).catch(() => undefined);
      const deployBaseline = logFileSize();
      await clickPanelButton("Deploy to", { timeoutMs: 30000, contains: true }); // "Deploy to {environment}"
      // Gate on the deploy's OWN log signals, not just on Dataverse state (CLAUDE.md: wait for the
      // command's FINAL line, or the suite ends mid-command and the next one overlaps it):
      //   "Saving Form: <id>"  → form-event registration actually ran (what this test's name claims);
      //   "Publish Complete"   → the LAST thing deploy does, so nothing is still in flight at teardown.
      await waitForLogFile(/Saving Form: /, { timeoutMs: 300000, sinceByte: deployBaseline });
      await waitForLogFile("Publish Complete", { timeoutMs: 300000, sinceByte: deployBaseline });
      // Deploy = build + upsert web resource + register form events + publish. Poll Dataverse.
      let id: string | undefined;
      const deadline = Date.now() + 300000;
      do {
        try {
          id = await client.findWebresourceId(libraryName());
        } catch {
          /* transient */
        }
        if (id) {
          break;
        }
        await sleep(5000);
      } while (Date.now() < deadline);
      if (!id) {
        throw new Error(`web resource ${libraryName()} not found in Dataverse after deploy`);
      }
      const content = await client.getWebresourceContent(libraryName());
      if (!content || content.length < 10) {
        throw new Error(`web resource ${libraryName()} deployed but content is empty`);
      }
      // The bundle must be THIS suite's build: the class written in the previous step has to be in the
      // deployed JS. "a web resource of that name exists and is non-empty" was true of any other
      // suite's leftover too, which is what made this assertion hollow (#249).
      if (!content.includes(className)) {
        throw new Error(`web resource ${libraryName()} deployed but does not contain ${className} — the bundle is not this suite's build`);
      }
      return `web resource ${libraryName()} deployed (id ${id}, ${content.length} bytes of JS containing ${className}), form event registered + published`;
    });
  });

  after(async function () {
    try {
      await client.deleteWebresource(libraryName());
    } catch {
      /* best-effort cleanup */
    }
  });
});
