import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { createWebresourceTestController } from "../../webresources/webresourceTestController";
import { createPluginTestController } from "../../plugins/pluginTestController";

// Integration guard for the #124 duplicate-TestController crash: two components of the
// SAME type must get distinct controller ids, and re-initialising one must dispose the
// stale controller rather than collide. `vscode.tests.createTestController` throws on a
// duplicate id — the bug that shipped in 0.8.4 — so this runs in the real host. Pre-fix
// (hardcoded id) the first "two components" test threw; post-fix (scopedTestControllerId
// + dispose-on-reinit registry) all four pass. No live org / Selenium needed.

// A minimal stand-in for the scoped component context the factories consume. They only
// touch activeComponent (root/relativeRoot) and vscode.subscriptions.
function ctx(root: string, relativeRoot: string, type: string): any {
  return {
    vscode: { subscriptions: [] as vscode.Disposable[] },
    activeComponent: { root, relativeRoot, isRoot: false, settings: { type } },
    projectSettings: {},
    channel: { appendLine: () => undefined, show: () => undefined },
    components: [],
  };
}

suite("Multi-component TestController registration (integration, #124)", () => {
  let workspace = "";
  const roots: Record<string, string> = {};
  const created: vscode.TestController[] = [];

  suiteSetup(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-it-"));
    for (const name of ["web1", "web2", "plugin1", "plugin2"]) {
      roots[name] = path.join(workspace, name);
      fs.mkdirSync(roots[name], { recursive: true });
    }
  });

  suiteTeardown(() => {
    for (const controller of created) {
      try {
        controller.dispose();
      } catch {
        /* already disposed by the factory's dispose-on-reinit */
      }
    }
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  test("two web-resource components get distinct controllers (no duplicate-id crash)", () => {
    assert.doesNotThrow(() => {
      created.push(createWebresourceTestController(ctx(roots.web1, "web1", "webresources")));
      created.push(createWebresourceTestController(ctx(roots.web2, "web2", "webresources")));
    });
  });

  test("re-initialising the same web-resource component disposes the stale controller", () => {
    assert.doesNotThrow(() => {
      created.push(createWebresourceTestController(ctx(roots.web1, "web1", "webresources")));
      created.push(createWebresourceTestController(ctx(roots.web1, "web1", "webresources")));
    });
  });

  test("two plugin components get distinct controllers (no duplicate-id crash)", () => {
    assert.doesNotThrow(() => {
      created.push(createPluginTestController(ctx(roots.plugin1, "plugin1", "plugin")));
      created.push(createPluginTestController(ctx(roots.plugin2, "plugin2", "plugin")));
    });
  });

  test("re-initialising the same plugin component disposes the stale controller", () => {
    assert.doesNotThrow(() => {
      created.push(createPluginTestController(ctx(roots.plugin1, "plugin1", "plugin")));
      created.push(createPluginTestController(ctx(roots.plugin1, "plugin1", "plugin")));
    });
  });
});
