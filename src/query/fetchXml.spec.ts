import { describe, it, expect } from "vitest";
import { parseFetchXml, serializeFetchXml, minifyFetchXml, detectFormat, escapeXmlAttribute, DEFAULT_FORMAT } from "./fetchXml";
import { attrBool, entityScopes, isAggregate, nodesEqual, queryEntity, cloneNode } from "./queryModel";

/** Parse and re-serialize with the source's own detected formatting. */
function roundTrip(xml: string): string {
  const parsed = parseFetchXml(xml);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return serializeFetchXml(parsed.root, parsed.format);
}

const FULL = `<fetch top="50" distinct="true">
  <entity name="account">
    <attribute name="name" alias="n" />
    <order attribute="name" descending="true" />
    <filter type="and">
      <condition attribute="statecode" operator="eq" value="0" />
      <filter type="or">
        <condition attribute="name" operator="like" value="%a&amp;b%" />
        <condition attribute="accountid" operator="in">
          <value>1</value>
          <value>2</value>
        </condition>
      </filter>
    </filter>
    <link-entity name="contact" from="parentcustomerid" to="accountid" alias="c" link-type="outer">
      <attribute name="fullname" />
    </link-entity>
  </entity>
</fetch>`;

describe("parse / serialize round trip", () => {
  it("reproduces a full query byte-for-byte", () => {
    expect(roundTrip(FULL)).toBe(FULL);
  });

  it("reproduces a single-line query on one line", () => {
    const xml = `<fetch><entity name="account"><attribute name="name" /></entity></fetch>`;
    expect(roundTrip(xml)).toBe(xml);
  });

  it("preserves single-quoted attributes, the style used inside code literals", () => {
    const xml = `<fetch><entity name='account'><attribute name='name' /></entity></fetch>`;
    expect(roundTrip(xml)).toBe(xml);
  });

  it("preserves a bare <filter> fragment root", () => {
    const xml = `<filter type="and">\n  <condition attribute="statecode" operator="eq" value="0" />\n</filter>`;
    const parsed = parseFetchXml(xml);
    expect(parsed.ok && parsed.root.tag).toBe("filter");
    expect(roundTrip(xml)).toBe(xml);
  });

  it("preserves comments rather than silently deleting them", () => {
    const xml = `<fetch>\n  <!-- only active -->\n  <entity name="account" />\n</fetch>`;
    expect(roundTrip(xml)).toContain("<!-- only active -->");
  });

  it("preserves attributes the generator knows nothing about", () => {
    const xml = `<fetch no-lock="true" latematerialize="true" useraworderby="1"><entity name="account" mystery="keep" /></fetch>`;
    expect(roundTrip(xml)).toBe(xml);
  });

  it("preserves a boolean attribute written without a value", () => {
    const parsed = parseFetchXml(`<fetch distinct><entity name="account" /></fetch>`);
    expect(parsed.ok && serializeFetchXml(parsed.root, parsed.format)).toBe(`<fetch distinct><entity name="account" /></fetch>`);
  });

  it("round-trips escaped values without double-escaping", () => {
    const xml = `<fetch><entity name="account"><filter><condition attribute="name" operator="eq" value="a &amp; b &lt; c" /></filter></entity></fetch>`;
    expect(roundTrip(xml)).toBe(xml);
    expect(roundTrip(roundTrip(xml))).toBe(xml);
  });

  it("keeps @token placeholders untouched — they must survive to be substituted back", () => {
    const xml = `<fetch><entity name="account"><filter><condition attribute="accountid" operator="eq" value="@accountId" /></filter></entity></fetch>`;
    expect(roundTrip(xml)).toBe(xml);
  });
});

describe("parse failures", () => {
  it("rejects empty input", () => {
    expect(parseFetchXml("   ")).toEqual({ ok: false, error: "The query is empty." });
  });

  it("rejects a root that is not fetch or filter", () => {
    const result = parseFetchXml(`<entity name="account" />`);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("<entity>");
  });

  it("rejects mismatched tags", () => {
    expect(parseFetchXml(`<fetch><entity name="account"></fetch>`).ok).toBe(false);
  });
});

describe("format detection", () => {
  it("detects tab indentation and CRLF", () => {
    expect(detectFormat("<fetch>\r\n\t<entity name='a' />\r\n</fetch>")).toEqual({ indent: "\t", newline: "\r\n", quote: "'" });
  });

  it("defaults to double quotes when neither style dominates", () => {
    expect(detectFormat("<fetch />").quote).toBe('"');
  });
});

describe("accessors", () => {
  const root = (parseFetchXml(FULL) as { root: import("./queryModel").QueryNode }).root;

  it("finds the entity and its joins", () => {
    expect(queryEntity(root)?.attrs.name).toBe("account");
    expect(entityScopes(root).map((n) => n.attrs.name)).toEqual(["account", "contact"]);
  });

  it("reads booleans written either way", () => {
    expect(attrBool(root, "distinct")).toBe(true);
    expect(isAggregate(root)).toBe(false);
    expect(attrBool((parseFetchXml(`<fetch aggregate="1" />`) as { root: import("./queryModel").QueryNode }).root, "aggregate")).toBe(true);
  });
});

describe("structural comparison", () => {
  const root = (parseFetchXml(FULL) as { root: import("./queryModel").QueryNode }).root;

  it("treats a clone as equal and a changed value as different", () => {
    const clone = cloneNode(root);
    expect(nodesEqual(root, clone)).toBe(true);
    clone.attrs.top = "51";
    expect(nodesEqual(root, clone)).toBe(false);
  });

  it("ignores attribute order but not child order", () => {
    const a = parseFetchXml(`<fetch top="1" distinct="true" />`);
    const b = parseFetchXml(`<fetch distinct="true" top="1" />`);
    expect(a.ok && b.ok && nodesEqual(a.root, b.root)).toBe(true);

    const c = parseFetchXml(`<fetch><entity name="a" /><entity name="b" /></fetch>`);
    const d = parseFetchXml(`<fetch><entity name="b" /><entity name="a" /></fetch>`);
    expect(c.ok && d.ok && nodesEqual(c.root, d.root)).toBe(false);
  });
});

describe("minify", () => {
  it("collapses to one line for the ?fetchXml= URL path", () => {
    expect(minifyFetchXml((parseFetchXml(FULL) as { root: import("./queryModel").QueryNode }).root)).toBe(
      `<fetch top="50" distinct="true"><entity name="account"><attribute name="name" alias="n" /><order attribute="name" descending="true" /><filter type="and"><condition attribute="statecode" operator="eq" value="0" /><filter type="or"><condition attribute="name" operator="like" value="%a&amp;b%" /><condition attribute="accountid" operator="in"><value>1</value><value>2</value></condition></filter></filter><link-entity name="contact" from="parentcustomerid" to="accountid" alias="c" link-type="outer"><attribute name="fullname" /></link-entity></entity></fetch>`,
    );
  });
});

describe("attribute escaping", () => {
  it("escapes only the delimiting quote", () => {
    expect(escapeXmlAttribute(`he said "hi" & 'bye'`, '"')).toBe("he said &quot;hi&quot; &amp; 'bye'");
    expect(escapeXmlAttribute(`he said "hi" & 'bye'`, "'")).toBe('he said "hi" &amp; &apos;bye&apos;');
  });

  it("uses the default format when none is given", () => {
    expect(serializeFetchXml({ tag: "fetch", attrs: {}, children: [] }, DEFAULT_FORMAT)).toBe("<fetch />");
  });
});
