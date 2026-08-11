import { describe, it, expect } from "vitest";
import { CodeString, Language, chooseForm, encodeLiteral, languageFor, partsText, scanLanguage } from "./index";

function only(source: string, language: Language): CodeString {
  const found = scanLanguage(source, language);
  expect(found.length, `expected exactly one string, got ${found.length}`).toBe(1);
  return found[0];
}

/** The span the scanner claims, lifted straight out of the source — proves the offsets are right. */
function span(source: string, found: CodeString): string {
  return source.slice(found.start, found.end);
}

/** Scan → encode → scan again and assert the parts survive. Write-back fidelity in one line. */
function assertReEncodes(source: string, language: Language): string {
  const first = only(source, language);
  const form = chooseForm(language, first.form, first.parts);
  const encoded = encodeLiteral(language, first.parts, form);
  const second = only(encoded, language);
  expect(second.parts).toEqual(first.parts);
  return encoded;
}

describe("language mapping", () => {
  it("maps the VS Code language ids we handle", () => {
    expect(languageFor("csharp")).toBe("csharp");
    expect(languageFor("typescript")).toBe("typescript");
    expect(languageFor("typescriptreact")).toBe("typescript");
    expect(languageFor("javascript")).toBe("typescript");
    expect(languageFor("liquid")).toBeUndefined();
    expect(languageFor("plaintext")).toBeUndefined();
  });
});

describe("C# literals", () => {
  it("reads a regular string with escapes", () => {
    const found = only(`var x = "a\\"b\\n";`, "csharp");
    expect(found.parts).toEqual([{ kind: "text", value: 'a"b\n' }]);
    expect(found.form).toBe("regular");
  });

  it("reads a verbatim string, doubled quotes and all", () => {
    const source = `var x = @"<fetch><entity name=""account"" /></fetch>";`;
    const found = only(source, "csharp");
    expect(partsText(found.parts)).toBe(`<fetch><entity name="account" /></fetch>`);
    expect(found.form).toBe("verbatim");
    expect(span(source, found)).toBe(`@"<fetch><entity name=""account"" /></fetch>"`);
  });

  it("reads a multi-line verbatim string", () => {
    const source = `var x = @"<fetch>\n  <entity name='account' />\n</fetch>";`;
    expect(partsText(only(source, "csharp").parts)).toBe(`<fetch>\n  <entity name='account' />\n</fetch>`);
  });

  it("reads interpolation holes in $@ strings and keeps the expression verbatim", () => {
    const found = only(`var x = $@"<condition value='{accountId}' />";`, "csharp");
    expect(found.parts).toEqual([
      { kind: "text", value: "<condition value='" },
      { kind: "hole", expression: "accountId" },
      { kind: "text", value: "' />" },
    ]);
    expect(found.form).toBe("interpolatedVerbatim");
  });

  it("accepts the @$ prefix order too", () => {
    expect(only(`var x = @$"a{b}c";`, "csharp").form).toBe("interpolatedVerbatim");
  });

  it("keeps a format specifier as part of the expression", () => {
    const found = only(`var x = $"{since:yyyy-MM-dd}";`, "csharp");
    expect(found.parts).toEqual([{ kind: "hole", expression: "since:yyyy-MM-dd" }]);
  });

  it("handles a hole containing braces and a string", () => {
    const found = only(`var x = $"{dict["a"]}";`, "csharp");
    expect(found.parts).toEqual([{ kind: "hole", expression: 'dict["a"]' }]);
  });

  it("unescapes doubled braces in an interpolated string", () => {
    expect(partsText(only(`var x = $"{{literal}}";`, "csharp").parts)).toBe("{literal}");
  });

  it("does not treat a char literal's quote as a string delimiter", () => {
    const found = scanLanguage(`var q = '"'; var x = "real";`, "csharp");
    expect(found.map((f) => partsText(f.parts))).toEqual(["real"]);
  });

  it("ignores strings inside comments", () => {
    const found = scanLanguage(`// var x = "commented";\n/* "block" */\nvar y = "live";`, "csharp");
    expect(found.map((f) => partsText(f.parts))).toEqual(["live"]);
  });

  it("reads a raw string but marks it unwritable", () => {
    const source = 'var x = """\n    <fetch />\n    """;';
    const found = only(source, "csharp");
    expect(partsText(found.parts)).toBe("<fetch />");
    expect(found.writable).toBe(false);
  });

  it("joins a + concatenation chain into one span with holes for the operands", () => {
    const source = `var x = "<condition value='" + accountId + "' />";`;
    const found = only(source, "csharp");
    expect(found.form).toBe("concat");
    expect(found.parts).toEqual([
      { kind: "text", value: "<condition value='" },
      { kind: "hole", expression: "accountId" },
      { kind: "text", value: "' />" },
    ]);
    expect(span(source, found)).toBe(`"<condition value='" + accountId + "' />"`);
  });

  it("keeps a method call as a single operand", () => {
    const found = only(`var x = "a" + Escape(name, "x") + "b";`, "csharp");
    expect(found.parts).toEqual([
      { kind: "text", value: "a" },
      { kind: "hole", expression: 'Escape(name, "x")' },
      { kind: "text", value: "b" },
    ]);
  });

  it("merges adjacent literals in a chain into one text part", () => {
    expect(only(`var x = "a" + "b" + "c";`, "csharp").parts).toEqual([{ kind: "text", value: "abc" }]);
  });

  it("stops the chain at the statement end", () => {
    const source = `var x = "a" + b;\nvar y = "c";`;
    const found = scanLanguage(source, "csharp");
    expect(found).toHaveLength(2);
    expect(span(source, found[0])).toBe(`"a" + b`);
    expect(found[1].parts).toEqual([{ kind: "text", value: "c" }]);
  });

  it("spans a chain that wraps across lines", () => {
    const source = `var x = "<fetch>"\n  + inner\n  + "</fetch>";`;
    const found = only(source, "csharp");
    expect(found.parts).toEqual([
      { kind: "text", value: "<fetch>" },
      { kind: "hole", expression: "inner" },
      { kind: "text", value: "</fetch>" },
    ]);
  });

  it("does not join across a StringBuilder append — each literal stays separate", () => {
    const source = `sb.Append("<fetch>");\nsb.Append("<entity />");\nsb.Append("</fetch>");`;
    expect(scanLanguage(source, "csharp")).toHaveLength(3);
  });
});

describe("TypeScript literals", () => {
  it("reads single and double quoted strings", () => {
    const found = scanLanguage(`const a = 'x'; const b = "y";`, "typescript");
    expect(found.map((f) => [f.form, partsText(f.parts)])).toEqual([
      ["single", "x"],
      ["regular", "y"],
    ]);
  });

  it("reads a template literal with holes", () => {
    const found = only("const x = `<condition value='${accountId}' />`;", "typescript");
    expect(found.form).toBe("template");
    expect(found.parts).toEqual([
      { kind: "text", value: "<condition value='" },
      { kind: "hole", expression: "accountId" },
      { kind: "text", value: "' />" },
    ]);
  });

  it("reads a multi-line template literal", () => {
    expect(partsText(only("const x = `<fetch>\n  <entity name='a' />\n</fetch>`;", "typescript").parts)).toBe("<fetch>\n  <entity name='a' />\n</fetch>");
  });

  it("handles a hole containing a nested template and braces", () => {
    const found = only("const x = `${obj[`k`] + f({a: 1})}`;", "typescript");
    expect(found.parts).toEqual([{ kind: "hole", expression: "obj[`k`] + f({a: 1})" }]);
  });

  it("unescapes \\${ so it is text, not a hole", () => {
    expect(only("const x = `\\${notAHole}`;", "typescript").parts).toEqual([{ kind: "text", value: "${notAHole}" }]);
  });

  it("does not treat a quote inside a regex as a string delimiter", () => {
    const found = scanLanguage(`const r = /["']/g; const s = "real";`, "typescript");
    expect(found.map((f) => partsText(f.parts))).toEqual(["real"]);
  });

  it("still reads division as division", () => {
    const found = scanLanguage(`const n = a / b; const s = "real";`, "typescript");
    expect(found.map((f) => partsText(f.parts))).toEqual(["real"]);
  });

  it("joins a + concatenation chain", () => {
    const found = only(`const x = "<condition value='" + accountId + "' />";`, "typescript");
    expect(found.form).toBe("concat");
    expect(found.parts).toEqual([
      { kind: "text", value: "<condition value='" },
      { kind: "hole", expression: "accountId" },
      { kind: "text", value: "' />" },
    ]);
  });

  it("mixes quote styles across a chain", () => {
    expect(only(`const x = 'a' + b + "c";`, "typescript").parts).toEqual([
      { kind: "text", value: "a" },
      { kind: "hole", expression: "b" },
      { kind: "text", value: "c" },
    ]);
  });
});

describe("form selection and re-encoding", () => {
  it("keeps a single-line C# verbatim string verbatim", () => {
    expect(assertReEncodes(`var x = @"<fetch />";`, "csharp")).toBe(`@"<fetch />"`);
  });

  it("upgrades a C# regular string to verbatim once it spans lines", () => {
    const found = only(`var x = "<fetch />";`, "csharp");
    found.parts = [{ kind: "text", value: "<fetch>\n</fetch>" }];
    expect(chooseForm("csharp", found.form, found.parts)).toBe("verbatim");
    expect(encodeLiteral("csharp", found.parts, "verbatim")).toBe(`@"<fetch>\n</fetch>"`);
  });

  it("upgrades a C# verbatim string to interpolated verbatim once a parameter appears", () => {
    const parts = [
      { kind: "text" as const, value: "<condition value='" },
      { kind: "hole" as const, expression: "accountId" },
      { kind: "text" as const, value: "' />" },
    ];
    expect(chooseForm("csharp", "verbatim", parts)).toBe("interpolatedVerbatim");
    expect(encodeLiteral("csharp", parts, "interpolatedVerbatim")).toBe(`$@"<condition value='{accountId}' />"`);
  });

  it("escapes braces and quotes when writing an interpolated verbatim string", () => {
    const encoded = encodeLiteral("csharp", [{ kind: "text", value: `a "b" {c}` }], "interpolatedVerbatim");
    expect(encoded).toBe(`$@"a ""b"" {{c}}"`);
    expect(partsText(only(`var x = ${encoded};`, "csharp").parts)).toBe(`a "b" {c}`);
  });

  it("collapses a C# concatenation chain into one interpolated verbatim string", () => {
    const source = `var x = "<fetch>" + inner + "</fetch>";`;
    const found = only(source, "csharp");
    const form = chooseForm("csharp", found.form, found.parts);
    expect(form).toBe("interpolated");
    expect(encodeLiteral("csharp", found.parts, form)).toBe(`$"<fetch>{inner}</fetch>"`);
  });

  it("sends any parameterised or multi-line TS string to a template literal", () => {
    expect(chooseForm("typescript", "regular", [{ kind: "hole", expression: "x" }])).toBe("template");
    expect(chooseForm("typescript", "single", [{ kind: "text", value: "a\nb" }])).toBe("template");
    expect(chooseForm("typescript", "single", [{ kind: "text", value: "a" }])).toBe("single");
  });

  it("escapes backticks and ${ when writing a template literal", () => {
    const encoded = encodeLiteral("typescript", [{ kind: "text", value: "a `b` ${c}" }], "template");
    expect(encoded).toBe("`a \\`b\\` \\${c}`");
    expect(partsText(only(`const x = ${encoded};`, "typescript").parts)).toBe("a `b` ${c}");
  });

  it("re-encodes every shape without losing parts", () => {
    for (const [source, language] of [
      [`var x = @"<fetch><entity name=""a"" /></fetch>";`, "csharp"],
      [`var x = $@"<fetch>{id}</fetch>";`, "csharp"],
      [`var x = "<fetch>" + id + "</fetch>";`, "csharp"],
      [`var x = "plain";`, "csharp"],
      ["const x = `<fetch>${id}</fetch>`;", "typescript"],
      [`const x = '<fetch />';`, "typescript"],
      [`const x = "<fetch>" + id + "</fetch>";`, "typescript"],
    ] as [string, Language][]) {
      assertReEncodes(source, language);
    }
  });
});
