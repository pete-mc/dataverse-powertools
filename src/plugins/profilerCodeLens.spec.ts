import { describe, expect, it } from "vitest";
import { findPluginClasses } from "./profilerCodeLens";

describe("findPluginClasses", () => {
  it("finds decorated classes with their fully-qualified names and lines", () => {
    const source = [
      "using Microsoft.Xrm.Sdk;",
      "namespace Contoso.Plugins",
      "{",
      '  [CrmPluginRegistration("Create", "account", StageEnum.PostOperation, ExecutionModeEnum.Synchronous, "", "step", 1, IsolationModeEnum.Sandbox)]',
      "  public class AccountPlugin : PluginBase",
      "  {",
      "  }",
      "  public class Helper { }",
      '  [CrmPluginRegistration("Update", "contact")]',
      "  public sealed partial class ContactPlugin : PluginBase",
      "  {",
      "  }",
      "}",
    ].join("\n");
    const sites = findPluginClasses(source);
    expect(sites).toEqual([
      { typeName: "Contoso.Plugins.AccountPlugin", line: 4 },
      { typeName: "Contoso.Plugins.ContactPlugin", line: 9 },
    ]);
  });

  it("ignores undecorated classes and resets the attribute flag", () => {
    expect(findPluginClasses("namespace X\n{\n  public class Plain { }\n}")).toEqual([]);
  });

  it("handles file-scoped namespaces and missing namespace", () => {
    expect(findPluginClasses("namespace Fs.Scoped;\n[CrmPluginRegistration]\npublic class P {}")).toEqual([{ typeName: "Fs.Scoped.P", line: 2 }]);
    expect(findPluginClasses("[CrmPluginRegistration]\nclass NoNs {}")).toEqual([{ typeName: "NoNs", line: 1 }]);
  });
});
