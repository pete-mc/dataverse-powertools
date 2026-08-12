import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import { loadE2EEnv, freshWorkspace, waitForFile, waitForOutput, dismissOverlays, sleep, E2EClient } from "./lib";
import { clickPanelButton, expandComponentCards } from "../supervised/supervisedLib";
import { initProject, step, showLog } from "./acceptanceLib";

// ACCEPTANCE (button-driven, live Dataverse): the real main process for a Solution project —
// EXTRACT the solution from Dataverse + unpack it (source-control ready), PACK it back to a zip
// (the "build"), and DEPLOY (import) it. Solutions carry metadata, not code, so "write code" is
// N/A; the round-trip Extract→Pack→Deploy is the workflow. All via the panel's own buttons.
const COMPONENT = "Solution";

describe("ACCEPTANCE: Solution — extract, pack, deploy via panel buttons", function () {
  this.timeout(2400000);
  const env = loadE2EEnv();
  let workspace: string;
  let solutionFriendlyName: string;
  let client: E2EClient;

  function config(): { zipPath?: string; packagePath?: string } {
    const settings = JSON.parse(fs.readFileSync(path.join(workspace, "dataverse-powertools.json"), "utf8"));
    return settings.solutionConfig ?? {};
  }

  before(async function () {
    if (!env) {
      this.skip();
    }
    client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;
    workspace = freshWorkspace("acc-solution");
    await VSBrowser.instance.openResources(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    await showLog();
  });

  it("starts a Solution project (Initialise button + wizard)", async () => {
    await step(COMPONENT, "Start project (Initialise button)", async () => {
      await initProject("Solution", env!, solutionFriendlyName, async () => {
        /* solution needs no extra prompts beyond the connection + solution pick */
      });
      expect(await waitForFile(path.join(workspace, "dataverse-powertools.json"), 300000), "project scaffolded").to.equal(true);
      return "Solution project scaffolded + connected (service principal)";
    });
  });

  it("extracts + unpacks the solution — Extract button", async () => {
    await step(COMPONENT, "Extract + unpack (Extract button)", async () => {
      await expandComponentCards();
      await clickPanelButton("Extract", { timeoutMs: 30000 });
      const folder = config().packagePath ? path.resolve(workspace, config().packagePath!) : path.join(workspace, "src");
      // pac solution export + unpack — the unpack folder fills with the customizations XML tree.
      const deadline = Date.now() + 360000;
      let has = false;
      do {
        try {
          has = fs.existsSync(folder) && fs.readdirSync(folder).length > 0;
        } catch {
          has = false;
        }
        if (has) {
          break;
        }
        await sleep(4000);
      } while (Date.now() < deadline);
      if (!has) {
        throw new Error(`Extract produced no unpacked files under ${path.relative(workspace, folder)}`);
      }
      return `unpacked the solution into ${path.relative(workspace, folder)}/`;
    });
  });

  it("packs the solution to a zip — Pack button", async () => {
    await step(COMPONENT, "Pack (Pack button → .zip)", async () => {
      await expandComponentCards();
      await clickPanelButton("Pack", { timeoutMs: 30000 });
      const zip = config().zipPath ? path.resolve(workspace, config().zipPath!) : "";
      const deadline = Date.now() + 240000;
      let found = "";
      do {
        if (zip && fs.existsSync(zip)) {
          found = zip;
          break;
        }
        // Fall back to any .zip produced under the workspace.
        try {
          const anyZip = fs.readdirSync(workspace).find((f) => f.toLowerCase().endsWith(".zip"));
          if (anyZip) {
            found = path.join(workspace, anyZip);
            break;
          }
        } catch {
          /* ignore */
        }
        await sleep(4000);
      } while (Date.now() < deadline);
      if (!found) {
        throw new Error("Pack produced no solution .zip");
      }
      return `packed ${path.relative(workspace, found)}`;
    });
  });

  it("deploys (imports) the solution — Deploy button", async () => {
    await step(COMPONENT, "Deploy/import (Deploy button)", async () => {
      await expandComponentCards();
      await clickPanelButton("Deploy to", { timeoutMs: 30000, contains: true }); // primary "▶ Deploy to {environment}"
      // Deploy re-packs (managed + unmanaged) THEN imports + publishes — slow, so allow a generous
      // window before gating on the import-completion signal in the output channel.
      // Gate on the two lines the import path REALLY logs, in order: the import result, then the
      // publish that follows it (the command's final signal). These are ANDed — see waitForOutput.
      //
      // This previously passed four ALTERNATIVE phrasings to an all-must-match helper, two of which
      // ("imported successfully" lower-case, "Import complete") the extension never logs at all. The
      // condition was therefore unsatisfiable, so this step burned its full 900s and failed on every
      // run while the import itself was succeeding (#240).
      const done = await waitForOutput(["Solution Imported successfully", "Published All Customizations"], 900000);
      if (!done) {
        throw new Error("solution import did not report completion in the output channel");
      }
      // Confirm the target solution is still present/queryable after the round-trip import.
      const friendly = await client.getSolutionFriendlyName(env!.solutionName);
      if (!friendly) {
        throw new Error(`solution ${env!.solutionName} not found in Dataverse after import`);
      }
      return `imported the solution round-trip; ${env!.solutionName} present in Dataverse`;
    });
  });
});
