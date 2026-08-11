import { describe, it, expect } from "vitest";
import { detectQueries, queryAtOffset } from "./detect";
import { computeWriteBack, buildInsertion } from "./writeBack";
import { allTokenNames, detokenizeXml, identifierFrom, replaceTokens, tokenizeParts, tokensInXml } from "./holes";
import { minifyFetchXml, serializeFetchXml } from "./fetchXml";
import { detectConsumer } from "./consumers";

/** A realistic plugin file: verbatim FetchXML, one interpolated id, handed to FetchExpression. */
const CSHARP_PLUGIN = `using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

public class OpenCases : IPlugin
{
    public void Execute(IServiceProvider serviceProvider)
    {
        var service = GetService(serviceProvider);
        var accountId = Guid.NewGuid();
        var result = service.RetrieveMultiple(new FetchExpression($@"<fetch top='50'>
  <entity name='incident'>
    <attribute name='title' />
    <filter type='and'>
      <condition attribute='customerid' operator='eq' value='{accountId}' />
      <condition attribute='statecode' operator='eq' value='0' />
    </filter>
  </entity>
</fetch>"));
    }
}`;

/** A realistic web-resource file: template literal, two holes, handed to Xrm.WebApi. */
const TYPESCRIPT_WEBRESOURCE = `export async function openCases(accountId: string, since: Date): Promise<void> {
  const fetchXml = \`<fetch top='50'>
  <entity name='incident'>
    <attribute name='title' />
    <filter type='and'>
      <condition attribute='customerid' operator='eq' value='\${accountId}' />
      <condition attribute='createdon' operator='on-or-after' value='\${since.toISOString()}' />
    </filter>
  </entity>
</fetch>\`;
  const result = await Xrm.WebApi.retrieveMultipleRecords("incident", "?fetchXml=" + encodeURIComponent(fetchXml));
  console.log(result.entities.length);
}`;

describe("detection in C#", () => {
  const queries = detectQueries(CSHARP_PLUGIN, "csharp");

  it("finds exactly the one query", () => {
    expect(queries).toHaveLength(1);
    expect(queries[0].root.tag).toBe("fetch");
    expect(queries[0].writable).toBe(true);
  });

  it("replaces the interpolation with a readable token named after the variable", () => {
    expect(queries[0].tokens).toEqual([{ token: "@accountId", name: "accountId", expression: "accountId" }]);
    expect(queries[0].xml).toContain("value='@accountId'");
  });

  it("spans exactly the literal, so the write-back replaces nothing else", () => {
    const span = CSHARP_PLUGIN.slice(queries[0].start, queries[0].end);
    expect(span.startsWith('$@"<fetch')).toBe(true);
    expect(span.endsWith('</fetch>"')).toBe(true);
  });

  it("identifies the SDK consumer from the enclosing call", () => {
    expect(queries[0].consumer.id).toBe("sdkFetchExpression");
    expect(queries[0].consumer.urlBound).toBe(false);
  });
});

describe("detection in TypeScript", () => {
  const queries = detectQueries(TYPESCRIPT_WEBRESOURCE, "typescript");

  it("finds the query and both parameters", () => {
    expect(queries).toHaveLength(1);
    expect(queries[0].tokens.map((token) => token.name)).toEqual(["accountId", "since"]);
    expect(queries[0].tokens[1].expression).toBe("since.toISOString()");
  });

  it("identifies the Web API consumer, which is URL bound", () => {
    expect(queries[0].consumer.id).toBe("webApi");
    expect(queries[0].consumer.urlBound).toBe(true);
  });
});

describe("what must NOT be detected", () => {
  it("ignores FetchXML assembled with a StringBuilder", () => {
    const source = `var sb = new StringBuilder();
sb.Append("<fetch>");
sb.Append("<entity name='account' />");
sb.Append("</fetch>");`;
    expect(detectQueries(source, "csharp")).toEqual([]);
  });

  it("ignores a mention of <fetch in a comment", () => {
    expect(detectQueries(`// build a <fetch> here later\nvar x = "not xml";`, "csharp")).toEqual([]);
  });

  it("ignores XML that merely contains a fetch inside another root", () => {
    expect(detectQueries(`var x = @"<soap><fetch><entity name='a' /></fetch></soap>";`, "csharp")).toEqual([]);
  });

  it("ignores a string with no query at all, cheaply", () => {
    expect(detectQueries(`const a = "hello"; const b = 'world';`, "typescript")).toEqual([]);
  });

  it("ignores an incomplete query", () => {
    expect(detectQueries(`var x = @"<fetch><entity name='account'>";`, "csharp")).toEqual([]);
  });
});

describe("fragments and other consumers", () => {
  it("detects a bare <filter> passed to addCustomFilter", () => {
    const source = `lookup.addCustomFilter("<filter type='and'><condition attribute='statecode' operator='eq' value='0' /></filter>", "account");`;
    const queries = detectQueries(source, "typescript");
    expect(queries).toHaveLength(1);
    expect(queries[0].root.tag).toBe("filter");
    expect(queries[0].consumer.id).toBe("lookupFilter");
    expect(queries[0].consumer.expects).toBe("filter");
  });

  it("picks the nearest callee when several appear", () => {
    const source = `foo.addCustomFilter(x); bar.retrieveMultipleRecords("account", "?fetchXml=" + `;
    expect(detectConsumer(source, source.length, source.length, "typescript").id).toBe("webApi");
  });

  it("looks ahead when the query is assigned to a variable before being used", () => {
    const source = `const xml = @@LITERAL@@;\nawait Xrm.WebApi.retrieveMultipleRecords("account", "?fetchXml=" + xml);`;
    const start = source.indexOf("@@LITERAL@@");
    expect(detectConsumer(source, start, start + "@@LITERAL@@".length, "typescript").id).toBe("webApi");
  });

  it("prefers a callee behind over one ahead", () => {
    const source = `lookup.addCustomFilter(@@L@@, "account");\nfoo.retrieveMultipleRecords("a", b);`;
    const start = source.indexOf("@@L@@");
    expect(detectConsumer(source, start, start + 5, "typescript").id).toBe("lookupFilter");
  });

  it("falls back to unknown with no recognisable callee", () => {
    expect(detectConsumer("var xml = ", 10, 10, "csharp").id).toBe("unknown");
  });
});

describe("cursor targeting", () => {
  const queries = detectQueries(CSHARP_PLUGIN, "csharp");

  it("finds the query the cursor sits inside", () => {
    expect(queryAtOffset(queries, queries[0].start + 10)).toBe(queries[0]);
  });

  it("falls forward to the next query when the cursor is above it", () => {
    expect(queryAtOffset(queries, 0)).toBe(queries[0]);
  });

  it("returns nothing when the cursor is past the last query", () => {
    expect(queryAtOffset(queries, CSHARP_PLUGIN.length)).toBeUndefined();
  });
});

describe("token mapping", () => {
  it("names a parameter after the value, not the operation", () => {
    expect(identifierFrom("accountId", 1)).toBe("accountId");
    expect(identifierFrom("context.UserId", 1)).toBe("UserId");
    expect(identifierFrom("since:yyyy-MM-dd", 1)).toBe("since");
    expect(identifierFrom("since.toISOString()", 1)).toBe("since");
    expect(identifierFrom("SecurityElement.Escape(name)", 1)).toBe("name");
    expect(identifierFrom("DateTime.UtcNow", 1)).toBe("UtcNow");
    expect(identifierFrom('dict["some key"] + 1', 3)).toBe("dict");
  });

  it("falls back to pN when nothing in the expression names a value", () => {
    expect(identifierFrom("new Date()", 2)).toBe("p2");
    expect(identifierFrom('"x" + 1', 4)).toBe("p4");
  });

  it("gives one token to a repeated expression so it is prompted for once", () => {
    const { xml, tokens } = tokenizeParts([
      { kind: "text", value: "a" },
      { kind: "hole", expression: "id" },
      { kind: "text", value: "b" },
      { kind: "hole", expression: "id" },
    ]);
    expect(tokens).toHaveLength(1);
    expect(xml).toBe("a@idb@id");
  });

  it("disambiguates two different expressions that want the same name", () => {
    const { tokens } = tokenizeParts([
      { kind: "hole", expression: "a.Id" },
      { kind: "text", value: "-" },
      { kind: "hole", expression: "b.Id" },
    ]);
    expect(tokens.map((token) => token.name)).toEqual(["Id", "Id2"]);
  });

  it("round-trips parts through tokenize and detokenize", () => {
    const parts = [
      { kind: "text" as const, value: "<condition value='" },
      { kind: "hole" as const, expression: "accountId" },
      { kind: "text" as const, value: "' />" },
    ];
    const { xml, tokens } = tokenizeParts(parts);
    expect(detokenizeXml(xml, tokens)).toEqual(parts);
  });

  it("treats a token typed in the generator as a new parameter named after itself", () => {
    expect(detokenizeXml("value='@newParam'", [])).toEqual([
      { kind: "text", value: "value='" },
      { kind: "hole", expression: "newParam" },
      { kind: "text", value: "'" },
    ]);
  });

  it("does NOT mistake an email address for a parameter", () => {
    expect(detokenizeXml("value='peter@mcdonald.xyz'", [])).toEqual([{ kind: "text", value: "value='peter@mcdonald.xyz'" }]);
    expect(allTokenNames("value='peter@mcdonald.xyz'")).toEqual([]);
  });

  it("does recognise a token after a wildcard, as a like filter needs", () => {
    expect(allTokenNames("value='%@term%'")).toEqual(["term"]);
  });

  it("finds adjacent tokens", () => {
    expect(allTokenNames("<a x='@one' y='@two' />")).toEqual(["one", "two"]);
  });

  it("reports only tokens still present in the XML", () => {
    const tokens = [
      { token: "@a", name: "a", expression: "a" },
      { token: "@b", name: "b", expression: "b" },
    ];
    expect(tokensInXml("value='@a'", tokens).map((token) => token.name)).toEqual(["a"]);
  });

  it("leaves a token in place when resolve declines it", () => {
    expect(replaceTokens("x='@a' y='@b'", (name) => (name === "a" ? "1" : undefined))).toBe("x='1' y='@b'");
  });
});

describe("write-back", () => {
  const csharp = detectQueries(CSHARP_PLUGIN, "csharp")[0];
  const typescript = detectQueries(TYPESCRIPT_WEBRESOURCE, "typescript")[0];

  it("reports no change when the XML is untouched, so the file is never dirtied", () => {
    expect(computeWriteBack(csharp, csharp.xml)).toEqual({ ok: true, changed: false });
    expect(computeWriteBack(typescript, typescript.xml)).toEqual({ ok: true, changed: false });
  });

  it("reports no change when only formatting differs", () => {
    const reserialized = serializeFetchXml(csharp.root, { indent: "  ", newline: "\n", quote: "'" });
    expect(computeWriteBack(csharp, reserialized)).toEqual({ ok: true, changed: false });
  });

  it("writes an edited C# query back as an interpolated verbatim string with the original expression", () => {
    const edited = csharp.xml.replace("top='50'", "top='10'");
    const result = computeWriteBack(csharp, edited);
    expect(result.ok && result.changed).toBe(true);
    const text = (result as { text: string }).text;
    expect(text.startsWith('$@"')).toBe(true);
    expect(text).toContain("top='10'");
    expect(text).toContain("{accountId}");
    expect(text).not.toContain("@accountId");
  });

  it("writes an edited TS query back as a template literal keeping the call expression", () => {
    const edited = typescript.xml.replace("top='50'", "top='5'");
    const result = computeWriteBack(typescript, edited);
    const text = (result as { text: string }).text;
    expect(text.startsWith("`")).toBe(true);
    expect(text).toContain("${since.toISOString()}");
    expect(text).toContain("top='5'");
  });

  it("substituting the written text back into the file yields code the scanner reads identically", () => {
    const edited = csharp.xml.replace("top='50'", "top='25'");
    const result = computeWriteBack(csharp, edited) as { text: string };
    const updated = CSHARP_PLUGIN.slice(0, csharp.start) + result.text + CSHARP_PLUGIN.slice(csharp.end);
    const requeried = detectQueries(updated, "csharp");
    expect(requeried).toHaveLength(1);
    expect(requeried[0].xml).toBe(edited);
    expect(requeried[0].tokens).toEqual(csharp.tokens);
  });

  it("refuses malformed XML rather than writing it", () => {
    const result = computeWriteBack(csharp, "<fetch><entity></fetch>");
    expect(result.ok).toBe(false);
  });

  it("refuses to write a raw string literal", () => {
    const raw = detectQueries('var x = """\n    <fetch><entity name=\'a\' /></fetch>\n    """;', "csharp")[0];
    expect(raw.writable).toBe(false);
    const result = computeWriteBack(raw, raw.xml.replace("'a'", "'b'"));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("read-only");
  });

  it("adds a new parameter as an interpolation, upgrading the literal form", () => {
    const plain = detectQueries(`var x = @"<fetch><entity name='account'><filter><condition attribute='name' operator='eq' value='x' /></filter></entity></fetch>";`, "csharp")[0];
    const result = computeWriteBack(plain, plain.xml.replace("value='x'", "value='@wanted'")) as { text: string };
    expect(result.text.startsWith('$@"')).toBe(true);
    expect(result.text).toContain("{wanted}");
  });

  it("escapes a quote that appears in an edited value", () => {
    const plain = detectQueries(`var x = @"<fetch><entity name='account'><filter><condition attribute='name' operator='eq' value='x' /></filter></entity></fetch>";`, "csharp")[0];
    const result = computeWriteBack(plain, plain.xml.replace(`value='x'`, `value="O&apos;Brien"`)) as { text: string };
    // A verbatim string doubles its quotes; re-reading must give back exactly one.
    expect(result.text).toContain(`value=""O&apos;Brien""`);
    const reread = detectQueries(`var x = ${result.text};`, "csharp")[0];
    expect(reread.root.children[0].children[0].children[0].attrs.value).toBe("O'Brien");
  });
});

describe("insertion of a new query", () => {
  it("emits a C# verbatim string indented to the cursor", () => {
    const xml = "<fetch>\n  <entity name='account' />\n</fetch>";
    expect(buildInsertion(xml, "csharp", "    ")).toBe(`@"<fetch>\n      <entity name='account' />\n    </fetch>"`);
  });

  it("emits a TS template literal", () => {
    expect(buildInsertion("<fetch />", "typescript")).toBe("`<fetch />`");
  });

  it("round-trips through detection", () => {
    const literal = buildInsertion("<fetch>\n  <entity name='account' />\n</fetch>", "csharp");
    expect(detectQueries(`var q = ${literal};`, "csharp")).toHaveLength(1);
  });
});

describe("minified length, as the URL check sees it", () => {
  it("collapses whitespace so the estimate reflects what is sent", () => {
    const query = detectQueries(CSHARP_PLUGIN, "csharp")[0];
    expect(minifyFetchXml(query.root).length).toBeLessThan(query.xml.length);
  });
});
