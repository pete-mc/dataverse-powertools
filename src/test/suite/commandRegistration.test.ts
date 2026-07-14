import * as assert from "assert";
import * as vscode from "vscode";
import { projectTypeActivations } from "../../projectTypes/activation";

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

  test("the decoration CodeLens commands are registered globally (not per plugin component, #124)", async () => {
    // These register ONCE in activate(); if they get moved back into initialisePlugins,
    // a second plugin component throws "command already exists". Their presence after a
    // no-workspace activation proves they register at the global level.
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const id of ["dataverse-powertools.addClassDecorationAtLine", "dataverse-powertools.updateFilteringAttributesAtLine"]) {
      assert.ok(registered.has(id), `${id} should be registered globally`);
    }
  });
});
