import * as path from "path";
import * as fs from "fs";
import { expect } from "chai";
import { VSBrowser } from "vscode-extension-tester";
import { openWorkspaceFolder, loadE2EEnv, freshWorkspace, pickByLabel, dismissOverlays, sleep, answerText, expectOutput, clearOutput, runScopedIdentifier, E2EClient } from "./lib";
import { clickPanelButton, clickOverflowItem, expandComponentCards } from "../supervised/supervisedLib";
import { initProject, step, showLog } from "./acceptanceLib";

// ACCEPTANCE (button-driven, live Dataverse): the real main process for a PCF control — start the
// project (scaffolds the control code), restore deps, build the bundle, then PUSH it into Dataverse
// (pac pcf push) and verify the control's bundle web resource landed. All via the panel buttons.
const COMPONENT = "PCF";

/** Find a file matching predicate anywhere under dir (recursive, skips node_modules/obj). */
function findDeep(dir: string, predicate: (name: string, full: string) => boolean): string | undefined {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && predicate(e.name, full)) {
      return full;
    }
    if (e.isDirectory() && e.name !== "node_modules" && e.name !== "obj") {
      const hit = findDeep(full, predicate);
      if (hit) {
        return hit;
      }
    }
  }
  return undefined;
}

async function pollDeep(dir: string, predicate: (name: string, full: string) => boolean, timeoutMs: number): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = findDeep(dir, predicate);
    if (hit) {
      return hit;
    }
    if (Date.now() > deadline) {
      return undefined;
    }
    await sleep(4000);
  }
}

describe("ACCEPTANCE: PCF — build, code, publish via panel buttons", function () {
  this.timeout(2400000);
  const env = loadE2EEnv();
  let workspace: string;
  let solutionFriendlyName: string;
  let client: E2EClient;

  // Run-scoped (#258). The deployed `customcontrol` row is `{prefix}_{namespace}.{constructor}`,
  // and both come from `pac pcf init`. The extension now asks for them, so the suite can give each
  // run its own control instead of every run (and BOTH PCF suites) sharing pac's default
  // SampleNamespace.SampleControl and deploying over each other.
  const controlName = runScopedIdentifier("AccPcfControl");
  const CONTROL_NAMESPACE = "DvptE2E";

  /** Namespace + constructor from the scaffolded control manifest (for the deployed bundle name). */
  function manifest(): { namespace: string; constructor: string } {
    const file = findDeep(workspace, (name) => name === "ControlManifest.Input.xml");
    if (!file) {
      throw new Error("no ControlManifest.Input.xml scaffolded");
    }
    const xml = fs.readFileSync(file, "utf8");
    const ns = /namespace="([^"]+)"/.exec(xml)?.[1] ?? "";
    const ctor = /constructor="([^"]+)"/.exec(xml)?.[1] ?? "";
    return { namespace: ns, constructor: ctor };
  }

  before(async function () {
    if (!env) {
      this.skip();
    }
    client = new E2EClient(env!);
    await client.connect();
    solutionFriendlyName = (await client.getSolutionFriendlyName(env!.solutionName)) ?? env!.solutionName;
    workspace = freshWorkspace("acc-pcf");
    await openWorkspaceFolder(workspace);
    await VSBrowser.instance.waitForWorkbench();
    await sleep(3500);
    await dismissOverlays();
    await showLog();
  });

  it("starts a PCF project — scaffolds the control code (Initialise button + template/framework pick)", async () => {
    await step(COMPONENT, "Write code (scaffold control via pac pcf init)", async () => {
      await initProject("PCF Control", env!, solutionFriendlyName, async () => {
        await pickByLabel("Field"); // control template
        await pickByLabel("Standard (no framework)"); // rendering framework
        await answerText(controlName); // control name — run-scoped (#258)
        await answerText(CONTROL_NAMESPACE); // control namespace
      });
      const idx = await pollDeep(workspace, (name) => name === "index.ts", 300000);
      const man = await pollDeep(workspace, (name) => name === "ControlManifest.Input.xml", 60000);
      if (!idx || !man) {
        throw new Error("PCF control code (index.ts + ControlManifest) not scaffolded");
      }
      const m = manifest();
      return `scaffolded control ${m.namespace}.${m.constructor} (index.ts + ControlManifest.Input.xml)`;
    });
  });

  it("restores dependencies + builds the bundle — Restore + Local Build buttons", async () => {
    await step(COMPONENT, "Build (Restore deps + Local Build → out/controls/bundle.js)", async () => {
      // The system-requirement scan kicked off by project init re-renders the panel on every
      // progress tick, and each re-render used to close an overflow menu we had just opened —
      // so the click below could never land while the scan ran (#259). The product now keeps
      // the menu open across a re-render, but gating on the scan's FINAL line still removes
      // the overlap rather than relying on the repair. No clearOutput first: the line may
      // already have been written during init, and it is only ever appended.
      await expectOutput("Requirement scan complete.", { timeoutMs: 180000, failMarkers: [], step: "requirement scan" });

      // pcf build (pcf-scripts) needs node_modules; a user runs Restore dependencies first.
      await clearOutput();
      await expandComponentCards();
      await clickOverflowItem("Restore dependencies", { timeoutMs: 45000 });
      // Gate on the restore's own final line, not on package-lock.json appearing: npm writes
      // the lockfile mid-install, so polling for it let Local Build start while the restore was
      // still running, and the two commands interleaved.
      await expectOutput("Restore Complete.", { timeoutMs: 600000, step: "restore dependencies" });
      await sleep(4000);
      await expandComponentCards();
      await clickPanelButton("Local Build", { timeoutMs: 30000 });
      const bundle = await pollDeep(workspace, (name, full) => name === "bundle.js" && /out[\\/]controls[\\/]/.test(full), 420000);
      if (!bundle) {
        throw new Error("PCF build produced no out/controls/**/bundle.js");
      }
      return `built ${path.relative(workspace, bundle)}`;
    });
  });

  it("publishes the control — Push button; verifies the bundle in Dataverse", async () => {
    await step(COMPONENT, "Publish (Push to environment → pac pcf push)", async () => {
      await expandComponentCards();
      await clickPanelButton("Push to", { timeoutMs: 30000, contains: true }); // primary "▶ Push to {environment}"
      const m = manifest();
      const wrName = `cc_${m.namespace}.${m.constructor}/bundle.js`;
      let id: string | undefined;
      const deadline = Date.now() + 420000;
      do {
        try {
          id = await client.findWebresourceId(wrName);
        } catch {
          /* transient */
        }
        if (id) {
          break;
        }
        await sleep(6000);
      } while (Date.now() < deadline);
      if (!id) {
        throw new Error(`PCF control bundle web resource ${wrName} not found in Dataverse after push`);
      }
      return `control bundle ${wrName} present in Dataverse (id ${id})`;
    });
  });

  after(async function () {
    try {
      const m = manifest();
      // The customcontrol row REFERENCES its bundle web resource, so the resource can't go until
      // the control does — and the control was never deleted at all, so a run-scoped control (#258)
      // accumulated one per run. pcfInteractiveLifecycle already did this; this suite didn't.
      const control = `${m.namespace}.${m.constructor}`;
      if (await client.deleteCustomControl(control)) {
        console.log(`    [e2e] [cleanup] removed custom control ${control}`);
      }
      if (!(await client.deleteWebresource(`cc_${control}/bundle.js`))) {
        console.log(`    [e2e] [cleanup] WARNING: cc_${control}/bundle.js is still deployed — delete it by hand`);
      }
    } catch {
      /* best-effort cleanup */
    }
  });
});
