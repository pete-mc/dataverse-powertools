import * as assert from "assert";
import * as vscode from "vscode";

// Integration test (#140): the Language Model Tools register once, globally, in a
// real extension host — so Copilot agent mode can see them. Mirrors the
// command-registration integration test.

suite("Language Model Tools registration (integration, #140)", () => {
  const expected = ["dvpt_connectionStatus", "dvpt_listComponents", "dvpt_systemRequirements", "dvpt_deploy", "dvpt_generateEarlybound"];

  test("every contributed LM tool is registered on the host", async () => {
    const ext = vscode.extensions.getExtension("dataversepowertools.dataverse-powertools");
    assert.ok(ext, "extension should be present");
    await ext!.activate();

    // vscode.lm.tools is the readonly list of registered tools.
    const registered = new Set((vscode.lm.tools ?? []).map((t) => t.name));
    for (const name of expected) {
      assert.ok(registered.has(name), `LM tool '${name}' should be registered`);
    }
  });
});
