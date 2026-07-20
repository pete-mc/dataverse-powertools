import * as assert from "assert";
import * as vscode from "vscode";
import { projectTypeActivations } from "../../projectTypes/activation";
import { projectTypeRegistry } from "../../projectTypes/registry";

// Integration test (real VS Code extension host): activate the extension and assert
// its command wiring. Catches renamed/missing commands and a broken
// registerAllComponentCommands WITHOUT Selenium or a live Dataverse org — the cheap,
// CI-runnable middle layer the suite was missing.

const EXTENSION_ID = "dataversepowertools.dataverse-powertools";

suite("Command registration (integration)", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found in the host`);
    await ext.activate();
  });

  test("every command registerAllComponentCommands owns is registered in the host", async () => {
    // The contract of registerAllComponentCommands: it registers every command in each
    // type's activation.commands map, once, at activation. (The registry's broader
    // commandIds UNION also includes lazily/per-component-registered commands — e.g. the
    // modelbuilder tree's editModelBuilderSetting, created on first openEarlyboundConfig —
    // which a no-workspace activation legitimately hasn't registered yet; verifying those
    // needs a plugin-component fixture, see #143.)
    const registered = new Set(await vscode.commands.getCommands(true));
    const expected = Object.values(projectTypeActivations).flatMap((activation) => Object.keys(activation.commands));
    const missing = expected.filter((id) => !registered.has(id));
    assert.deepStrictEqual(missing, [], `commands in activation.commands not registered: ${missing.join(", ")}`);
  });

  test("every registry command is registered, or is a known lazily-registered one (#147 — no dead declarations)", async () => {
    // The registry's commandIds are declared AND contributed in package.json but must also
    // be REGISTERED somewhere — otherwise they show in the Command Palette and fail
    // "command not found" when invoked (as editPluginMessageFilter/togglePluginEmitEntityEtc
    // did until they were removed). Everything except the lazily-registered modelbuilder tree
    // editor (created on first openEarlyboundConfig) is registered at activation.
    const registered = new Set(await vscode.commands.getCommands(true));
    const KNOWN_LAZY = new Set(["dataverse-powertools.editModelBuilderSetting"]);
    const orphans = projectTypeRegistry.flatMap((descriptor) => [...descriptor.commandIds]).filter((id) => !registered.has(id) && !KNOWN_LAZY.has(id));
    assert.deepStrictEqual(orphans, [], `registry commands neither registered nor known-lazy (dead / unwired): ${orphans.join(", ")}`);
  });

  test("the decoration CodeLens commands are registered globally (not per plugin component, #124)", async () => {
    // These register ONCE in activate(); if they get moved back into initialisePlugins,
    // a second plugin component throws "command already exists". Their presence after a
    // no-workspace activation proves they register at the global level.
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const id of ["dataverse-powertools.addClassDecorationAtLine", "dataverse-powertools.updateFilteringAttributesAtLine"]) {
      assert.ok(registered.has(id), `${id} should be registered globally`);
    }
  });

  test("the workspace/connection commands register ONCE at activation, not per workspace load", async () => {
    // These used to register inside generalInitialise (the connected `else` branch), which runs
    // on EVERY workspace load and again from createNewProject — so the 2nd init threw "command
    // already exists" and cascaded into "command 'dataverse-powertools.restoreDependencies' not
    // found" when a panel button fired it. They now register ONCE in activate() via
    // registerGlobalCommands. Two guarantees this asserts against a NO-WORKSPACE, NO-CONNECTION
    // activation: (a) they exist even without a loaded connection — pre-fix they were gated behind
    // the else branch and would be MISSING here; (b) activation didn't throw registering them.
    const registered = new Set(await vscode.commands.getCommands(true));
    const GLOBAL_COMMANDS = [
      "dataverse-powertools.initialiseProject",
      "dataverse-powertools.createConnectionString",
      "dataverse-powertools.restoreDependencies",
      "dataverse-powertools.updateConnectionString",
      "dataverse-powertools.switchEnvironment",
      "dataverse-powertools.refreshConnection",
      "dataverse-powertools.setTraceLogLevel",
      "dataverse-powertools.clearPacCredentials",
      "dataverse-powertools.openEnvironment",
      "dataverse-powertools.openAdminCenter",
      "dataverse-powertools.openMakerPortal",
      "dataverse-powertools.openSettings",
      "dataverse-powertools.addComponent",
      "dataverse-powertools.convertToComponentsWorkspace",
    ];
    const missing = GLOBAL_COMMANDS.filter((id) => !registered.has(id));
    assert.deepStrictEqual(missing, [], `workspace/connection commands not registered at activation: ${missing.join(", ")}`);
  });

  test("restoreDependencies survives repeated workspace re-initialisation (idempotent init)", async () => {
    // The regression: generalInitialise re-runs per workspace load; if it (re-)registered commands,
    // the 2nd run would throw and drop restoreDependencies. Re-running the init path must be a
    // no-op for registration. We can't cheaply drive a full re-init here, so assert the invariant
    // that guarantees it: registerGlobalCommands is register-ONCE — a second call throws (which is
    // exactly why it lives in activate(), not in the per-load generalInitialise). Combined with the
    // test above (they're registered at activation), this pins registration out of the re-run path.
    const { registerGlobalCommands } = await import("../../general/initialiseExtension");
    const fakeCtx = { vscode: { subscriptions: [] as vscode.Disposable[] }, openSettings: () => undefined } as never;
    assert.throws(() => registerGlobalCommands(fakeCtx), /already exists/i, "registerGlobalCommands must be register-once (it already ran at activation)");
    // Nothing partially registered: the throw is on the first id, all of which already exist.
    assert.ok((await vscode.commands.getCommands(true)).includes("dataverse-powertools.restoreDependencies"), "restoreDependencies stays registered");
  });
});
