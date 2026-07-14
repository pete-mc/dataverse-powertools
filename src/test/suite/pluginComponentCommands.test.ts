import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { openEarlyboundConfig } from "../../plugins/pluginTables";
import { projectTypeRegistry } from "../../projectTypes/registry";

// #147: `registry.commandIds` is a SUPERSET of what `registerAllComponentCommands` wires at
// activation — a few commands register LAZILY. The modelbuilder tree's
// `editModelBuilderSetting` is created in the `PluginModelBuilderTreeDataProvider`
// constructor, which only runs on the first "Configure Earlybound" (openEarlyboundConfig).
// The no-workspace commandRegistration.test can only assert the EAGER set and has to
// whitelist that one lazy id — so nothing proves the lazy path actually registers it, or
// that the whitelist stays a whitelist-of-one. This suite drives the real lazy path against
// a plugin-component fixture and asserts the FULL registry set ends up registered with no
// remaining gap.

const EXTENSION_ID = "dataversepowertools.dataverse-powertools";

// A minimal stand-in for the scoped plugin-component context openEarlyboundConfig consumes.
// It touches vscode.subscriptions (to own the registered command + tree view), and
// activeComponent.root (to locate modelbuilder.json — absent here, so settings load is a
// graceful no-op). projectSettings starts empty; the loader fills pluginModelBuilder.
function pluginCtx(root: string): any {
  return {
    vscode: { subscriptions: [] as vscode.Disposable[] },
    activeComponent: { root, relativeRoot: path.basename(root), isRoot: false, settings: { type: "plugin" } },
    projectSettings: {},
    channel: { appendLine: () => undefined, show: () => undefined },
    components: [],
  };
}

suite("Plugin-component command registration (integration, #147)", () => {
  let workspace = "";
  let pluginRoot = "";

  suiteSetup(async function () {
    this.timeout(60000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found in the host`);
    await ext.activate();
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-plugin-it-"));
    pluginRoot = path.join(workspace, "plugin1");
    fs.mkdirSync(pluginRoot, { recursive: true });
  });

  suiteTeardown(() => {
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  test("Configure Earlybound registers the lazily-created modelbuilder command (#147)", async () => {
    // The premise of the whitelist in commandRegistration.test: this command is NOT wired by
    // registerAllComponentCommands, only by the tree provider's constructor. Driving
    // openEarlyboundConfig (what the "Configure Earlybound" card action calls) must create it.
    await openEarlyboundConfig(pluginCtx(pluginRoot));
    const registered = new Set(await vscode.commands.getCommands(true));
    assert.ok(registered.has("dataverse-powertools.editModelBuilderSetting"), "editModelBuilderSetting should be registered after Configure Earlybound opens the tree");
  });

  test("with every registration path driven, the FULL registry.commandIds set is registered — no dead declarations (#147)", async () => {
    // The gap commandRegistration.test can't reach: once the lazy path has run, EVERY id the
    // registry declares (and package.json contributes) must be registered. A renamed/dropped
    // command in any of the three registration paths surfaces here as an orphan, in CI,
    // without Selenium or a live org.
    await openEarlyboundConfig(pluginCtx(pluginRoot));
    const registered = new Set(await vscode.commands.getCommands(true));
    const orphans = projectTypeRegistry.flatMap((descriptor) => [...descriptor.commandIds]).filter((id) => !registered.has(id));
    assert.deepStrictEqual(orphans, [], `registry commands still unregistered after driving every registration path: ${orphans.join(", ")}`);
  });
});
