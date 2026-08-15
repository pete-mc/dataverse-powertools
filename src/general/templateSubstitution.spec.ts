import { describe, it, expect } from "vitest";
import { applyPlaceholders, applyProjectPlaceholders } from "./templateSubstitution";
import { TemplatePlaceholder } from "../context";
import { buildWebResourceClassPlaceholders } from "../webresources/webResourceClassTemplate";

const subs = (pairs: Array<[string, string | undefined]>): TemplatePlaceholder[] => pairs.map(([placeholder, value]) => ({ placeholder, value }) as TemplatePlaceholder);

describe("applyPlaceholders", () => {
  it("replaces every occurrence", () => {
    expect(applyPlaceholders("class ClassName { } // ClassName", subs([["ClassName", "Territory"]]))).toBe("class Territory { } // Territory");
  });

  it("leaves a placeholder with no value in place, so a skipped prompt is visible in the scaffold", () => {
    expect(applyPlaceholders("x = ClassName;", subs([["ClassName", undefined]]))).toBe("x = ClassName;");
    expect(applyPlaceholders("x = ClassName;", subs([["ClassName", ""]]))).toBe("x = ClassName;");
  });

  it("is a no-op with no placeholders", () => {
    expect(applyPlaceholders("nothing to do", [])).toBe("nothing to do");
    expect(applyPlaceholders("nothing to do", undefined)).toBe("nothing to do");
  });

  it("ignores entries with an empty placeholder rather than replacing between every character", () => {
    expect(applyPlaceholders("abc", subs([["", "X"]]))).toBe("abc");
  });

  // The order bug: sequential .replace() re-scans text it just inserted, so a VALUE containing a
  // later placeholder's token got substituted again.
  it("does not re-substitute a value that contains another placeholder's token", () => {
    const result = applyPlaceholders(
      "<Form.TableName.Main.FormName> ClassName",
      subs([
        ["TableName", "account"],
        ["FormName", "Information"],
        ["ClassName", "FormNameHandler"],
      ]),
    );
    expect(result).toBe("<Form.account.Main.Information> FormNameHandler");
  });

  it("is order-independent — the reversed array gives the same result", () => {
    const pairs: Array<[string, string | undefined]> = [
      ["TableName", "account"],
      ["FormName", "Information"],
      ["ClassName", "FormNameHandler"],
    ];
    const text = "<Form.TableName.Main.FormName> ClassName";
    expect(applyPlaceholders(text, subs([...pairs].reverse()))).toBe(applyPlaceholders(text, subs(pairs)));
  });

  it("prefers the longest placeholder when one is a prefix of another", () => {
    expect(
      applyPlaceholders(
        "ClassNameTest and ClassName",
        subs([
          ["ClassName", "Foo"],
          ["ClassNameTest", "FooTest"],
        ]),
      ),
    ).toBe("FooTest and Foo");
  });

  // Placeholders came from template.json and were compiled with `new RegExp(...)`.
  it("treats the placeholder as a literal, not a pattern", () => {
    expect(applyPlaceholders("a.c and abc", subs([["a.c", "X"]]))).toBe("X and abc");
    expect(applyPlaceholders("$(NAME)", subs([["$(NAME)", "value"]]))).toBe("value");
  });

  // The value was used as a String.replace REPLACEMENT, where $& / $1 / $$ are expansion syntax.
  it("inserts the value literally, so a '$' in it is not expansion syntax", () => {
    expect(applyPlaceholders("cost = PRICE;", subs([["PRICE", "$&"]]))).toBe("cost = $&;");
    expect(applyPlaceholders("cost = PRICE;", subs([["PRICE", "$$100"]]))).toBe("cost = $$100;");
  });

  it("substitutes destination paths the same way (the path rewrite shares this code)", () => {
    expect(applyPlaceholders("/src/PROJECTNAMESPACE/PROJECTNAMESPACE.csproj", subs([["PROJECTNAMESPACE", "Contoso.Plugins"]]))).toBe("/src/Contoso.Plugins/Contoso.Plugins.csproj");
  });
});

describe("applyProjectPlaceholders", () => {
  it("fills the prefix and solution name", () => {
    expect(applyProjectPlaceholders('library: "SOLUTIONPREFIX", solution: "SOLUTIONPLACEHOLDER"', { prefix: "dvpt", solutionName: "PowerToolsDev" })).toBe(
      'library: "dvpt", solution: "PowerToolsDev"',
    );
  });

  it("keeps the tokens when the project has no connection configured yet", () => {
    expect(applyProjectPlaceholders("SOLUTIONPREFIX/SOLUTIONPLACEHOLDER", {})).toBe("SOLUTIONPREFIX/SOLUTIONPLACEHOLDER");
  });

  // The bug this module was extracted to fix: /\SOLUTIONPREFIX/g is `\S` (any non-whitespace)
  // followed by "OLUTIONPREFIX", so the match consumed the character before the token.
  it("does not eat the character preceding the token (the \\S regex-escape bug)", () => {
    expect(applyProjectPlaceholders("prefix=XSOLUTIONPREFIX", { prefix: "dvpt" })).toBe("prefix=Xdvpt");
    // …and does not match text that merely ENDS in OLUTIONPREFIX, which the old pattern did.
    expect(applyProjectPlaceholders("myOLUTIONPREFIX", { prefix: "dvpt" })).toBe("myOLUTIONPREFIX");
  });
});

// The scaffolded class is only correct if the placeholder set and the template agree; this pins
// the pair together so renaming a token in one without the other fails here rather than in a
// scaffolded project that doesn't compile.
describe("the web-resource class placeholders against the real template text", () => {
  const template = [
    "<PowerTools.RegisterEvent[]>[",
    '  { formId: "FORMIDPLACEHOLDER", event: "onload", triggerId: "NEWGUID", function: "SOLUTIONPREFIX.ClassName.OnLoad" },',
    "];",
    "export class ClassName {",
    "  static async OnLoad(executionContext: Xrm.ExecutionContext<unknown, unknown>): Promise<void> {",
    "    const form = <Form.TableName.Main.FormName>executionContext.getFormContext();",
    '    form.ui.setFormNotification("ClassName loaded", "INFO", "NOTIFICATIONID");',
    "  }",
    "}",
  ].join("\n");

  it("leaves no placeholder token behind", () => {
    const filled = applyPlaceholders(
      template,
      buildWebResourceClassPlaceholders({
        className: "TerritoryOnboarding",
        entity: "account",
        formName: "Account for Interactive experience",
        formId: "11111111-2222-3333-4444-555555555555",
        libraryPrefix: "dvpt",
        triggerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        notificationId: "notify-1",
      }),
    );
    for (const token of ["ClassName", "TableName", "FormName", "FORMIDPLACEHOLDER", "SOLUTIONPREFIX", "NEWGUID", "NOTIFICATIONID"]) {
      expect(filled, `${token} still present`).not.toContain(token);
    }
    expect(filled).toContain('function: "dvpt.TerritoryOnboarding.OnLoad"');
    // The form name is sanitized to a TS identifier before it reaches the type reference.
    expect(filled).toContain("<Form.account.Main.AccountforInteractiveexperience>");
  });

  it("survives a class name that contains another placeholder's token", () => {
    const filled = applyPlaceholders(
      template,
      buildWebResourceClassPlaceholders({
        className: "FormNameEditor",
        entity: "account",
        formName: "Information",
        formId: "id",
        libraryPrefix: "dvpt",
        triggerId: "t",
        notificationId: "n",
      }),
    );
    expect(filled).toContain("export class FormNameEditor {");
    expect(filled).toContain("<Form.account.Main.Information>");
  });
});
