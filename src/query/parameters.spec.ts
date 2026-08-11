import { describe, it, expect } from "vitest";
import { collectParameters, inferParameterType, normalizeParameterValue, substituteParameters, validateParameterValue } from "./parameters";
import { diagnoseQuery } from "./diagnostics";
import { detectQueries } from "./detect";
import { parseFetchXml } from "./fetchXml";
import { allTokenNames } from "./holes";
import { consumerById, UNKNOWN_CONSUMER } from "./consumers";
import { MetadataLookup } from "./metadata/cache";
import { QueryNode } from "./queryModel";

function rootOf(xml: string): QueryNode {
  const parsed = parseFetchXml(xml);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.root;
}

/** A metadata stand-in: knows one table, so it can answer both "yes" and "no" definitively. */
const metadata: MetadataLookup = {
  knownEntity: (entity) => ["incident", "account"].includes(entity),
  knownAttribute: (entity, attribute) => (entity === "incident" ? ["customerid", "createdon", "title", "statecode", "ticketnumber"].includes(attribute) : undefined),
  attributeType: (entity, attribute) =>
    entity === "incident" ? { customerid: "Customer", createdon: "DateTime", title: "String", statecode: "State", ticketnumber: "String" }[attribute] : undefined,
};

const PARAMETERISED = `<fetch>
  <entity name="incident">
    <filter type="and">
      <condition attribute="customerid" operator="eq" value="@accountId" />
      <condition attribute="createdon" operator="on-or-after" value="@since" />
      <condition attribute="title" operator="like" value="%@term%" />
      <condition attribute="createdon" operator="last-x-days" value="@days" />
    </filter>
  </entity>
</fetch>`;

describe("collecting parameters", () => {
  const root = rootOf(PARAMETERISED);
  const parameters = collectParameters(root, allTokenNames(PARAMETERISED));

  it("finds every parameter in document order with its usage", () => {
    expect(parameters.map((p) => p.name)).toEqual(["accountId", "since", "term", "days"]);
    expect(parameters[0].usages).toEqual([{ entity: "incident", attribute: "customerid", operator: "eq" }]);
  });

  it("records both usages of a parameter used twice, so it is prompted for once", () => {
    const xml = `<fetch><entity name="incident"><filter><condition attribute="createdon" operator="on-or-after" value="@d" /><condition attribute="createdon" operator="on-or-before" value="@d" /></filter></entity></fetch>`;
    const collected = collectParameters(rootOf(xml), allTokenNames(xml));
    expect(collected).toHaveLength(1);
    expect(collected[0].usages).toHaveLength(2);
  });

  it("finds a parameter inside <value> children of an in condition", () => {
    const xml = `<fetch><entity name="incident"><filter><condition attribute="statecode" operator="in"><value>@first</value><value>1</value></condition></filter></entity></fetch>`;
    expect(collectParameters(rootOf(xml), allTokenNames(xml)).map((p) => p.name)).toEqual(["first"]);
  });

  it("prefers a condition's entityname over the enclosing scope", () => {
    const xml = `<fetch><entity name="account"><link-entity name="contact" from="parentcustomerid" to="accountid" alias="c" /><filter><condition entityname="c" attribute="fullname" operator="eq" value="@who" /></filter></entity></fetch>`;
    expect(collectParameters(rootOf(xml), allTokenNames(xml))[0].usages[0].entity).toBe("c");
  });

  it("attaches the code expression when there is one", () => {
    const query = detectQueries(
      `var x = $@"<fetch><entity name='incident'><filter><condition attribute='customerid' operator='eq' value='{accountId}' /></filter></entity></fetch>";`,
      "csharp",
    )[0];
    const collected = collectParameters(query.root, allTokenNames(query.xml), Object.fromEntries(query.tokens.map((t) => [t.name, t.expression])));
    expect(collected[0].expression).toBe("accountId");
  });

  it("drops a parameter whose condition the user deleted", () => {
    const xml = `<fetch><entity name="incident" /></fetch>`;
    expect(collectParameters(rootOf(xml), ["accountId"])).toEqual([]);
  });
});

describe("inferring a parameter type", () => {
  const parameters = collectParameters(rootOf(PARAMETERISED), allTokenNames(PARAMETERISED));
  const byName = Object.fromEntries(parameters.map((p) => [p.name, p]));

  it("reads the type from metadata", () => {
    expect(inferParameterType(byName.accountId, metadata)).toBe("guid");
    expect(inferParameterType(byName.since, metadata)).toBe("datetime");
    expect(inferParameterType(byName.term, metadata)).toBe("string");
  });

  it("treats an -x-days operator as a COUNT, not a date, even on a date column", () => {
    expect(inferParameterType(byName.days, metadata)).toBe("number");
  });

  it("falls back to naming and operator heuristics with no metadata", () => {
    expect(inferParameterType(byName.accountId)).toBe("guid");
    expect(inferParameterType(byName.since)).toBe("datetime");
    expect(inferParameterType(byName.term)).toBe("string");
    expect(inferParameterType(byName.days)).toBe("number");
  });

  it("defaults to string when it knows nothing", () => {
    expect(inferParameterType({ name: "x", token: "@x", usages: [{}] })).toBe("string");
  });
});

describe("validating and normalising prompted values", () => {
  it("accepts a guid in any common shape and normalises it", () => {
    expect(validateParameterValue("guid", "{6B29FC40-CA47-1067-B31D-00DD010662DA}")).toBeUndefined();
    expect(normalizeParameterValue("guid", "{6B29FC40-CA47-1067-B31D-00DD010662DA}")).toBe("6b29fc40-ca47-1067-b31d-00dd010662da");
    expect(validateParameterValue("guid", "not-a-guid")).toContain("GUID");
  });

  it("rejects a non-number and accepts a decimal", () => {
    expect(validateParameterValue("number", "12.5")).toBeUndefined();
    expect(validateParameterValue("number", "ten")).toContain("number");
  });

  it("normalises a date to UTC, because FetchXML compares in UTC", () => {
    expect(normalizeParameterValue("datetime", "2026-01-31T00:00:00Z")).toBe("2026-01-31T00:00:00Z");
    expect(normalizeParameterValue("datetime", "2026-01-31T12:34:56.789Z")).toBe("2026-01-31T12:34:56Z");
    expect(validateParameterValue("datetime", "nonsense")).toContain("date");
  });

  it("normalises booleans to the 1/0 FetchXML expects", () => {
    expect(normalizeParameterValue("boolean", "true")).toBe("1");
    expect(normalizeParameterValue("boolean", "False")).toBe("0");
    expect(validateParameterValue("boolean", "maybe")).toContain("true or false");
  });

  it("requires a value", () => {
    expect(validateParameterValue("string", "  ")).toBe("Enter a value.");
  });
});

describe("substituting values for a run", () => {
  it("replaces tokens and leaves the rest alone", () => {
    expect(substituteParameters(`<condition value="@a" other="@b" />`, { a: "1" })).toBe(`<condition value="1" other="@b" />`);
  });

  it("escapes both quote styles, so a value cannot break out of its attribute", () => {
    expect(substituteParameters(`<condition value='@a' />`, { a: `O'Brien & "co" <x>` })).toBe(`<condition value='O&apos;Brien &amp; &quot;co&quot; &lt;x&gt;' />`);
  });

  it("produces XML that still parses after substitution", () => {
    const substituted = substituteParameters(PARAMETERISED, { accountId: "6b29fc40-ca47-1067-b31d-00dd010662da", since: "2026-01-01T00:00:00Z", term: "a & b", days: "7" });
    expect(parseFetchXml(substituted).ok).toBe(true);
    expect(allTokenNames(substituted)).toEqual([]);
  });
});

describe("diagnostics", () => {
  function diagnose(source: string, language: "csharp" | "typescript") {
    const query = detectQueries(source, language)[0];
    const parameters = collectParameters(query.root, allTokenNames(query.xml), Object.fromEntries(query.tokens.map((t) => [t.name, t.expression])));
    return diagnoseQuery({ root: query.root, consumer: query.consumer, language, parameters, metadata });
  }

  it("flags an unescaped string value interpolated into an attribute", () => {
    const found = diagnose(
      `var x = new FetchExpression($@"<fetch><entity name='incident'><filter><condition attribute='title' operator='like' value='%{term}%' /></filter></entity></fetch>");`,
      "csharp",
    );
    expect(found.map((d) => d.code)).toContain("unescapedValue");
    expect(found.find((d) => d.code === "unescapedValue")?.expression).toBe("term");
  });

  it("does not flag a value that is already escaped", () => {
    const found = diagnose(
      `var x = new FetchExpression($@"<fetch><entity name='incident'><filter><condition attribute='title' operator='like' value='%{SecurityElement.Escape(term)}%' /></filter></entity></fetch>");`,
      "csharp",
    );
    expect(found.map((d) => d.code)).not.toContain("unescapedValue");
  });

  it("does not flag a guid or date parameter, which cannot carry an injection", () => {
    const found = diagnose(
      `var x = new FetchExpression($@"<fetch><entity name='incident'><filter><condition attribute='customerid' operator='eq' value='{accountId}' /></filter></entity></fetch>");`,
      "csharp",
    );
    expect(found.map((d) => d.code)).not.toContain("unescapedValue");
  });

  it("flags a local-time date compared against a UTC column in C#", () => {
    const found = diagnose(
      `var x = new FetchExpression($@"<fetch><entity name='incident'><filter><condition attribute='createdon' operator='on-or-after' value='{DateTime.Now}' /></filter></entity></fetch>");`,
      "csharp",
    );
    expect(found.map((d) => d.code)).toContain("localTime");
  });

  it("does not flag DateTime.UtcNow", () => {
    const found = diagnose(
      `var x = new FetchExpression($@"<fetch><entity name='incident'><filter><condition attribute='createdon' operator='on-or-after' value='{DateTime.UtcNow}' /></filter></entity></fetch>");`,
      "csharp",
    );
    expect(found.map((d) => d.code)).not.toContain("localTime");
  });

  it("flags a raw new Date() in TypeScript but not one that was converted", () => {
    const bad = diagnose(
      "const q = `<fetch><entity name='incident'><filter><condition attribute='createdon' operator='on-or-after' value='${new Date()}' /></filter></entity></fetch>`;\nXrm.WebApi.retrieveMultipleRecords('incident', q);",
      "typescript",
    );
    expect(bad.map((d) => d.code)).toContain("localTime");

    const good = diagnose(
      "const q = `<fetch><entity name='incident'><filter><condition attribute='createdon' operator='on-or-after' value='${new Date().toISOString()}' /></filter></entity></fetch>`;\nXrm.WebApi.retrieveMultipleRecords('incident', q);",
      "typescript",
    );
    expect(good.map((d) => d.code)).not.toContain("localTime");
  });

  it("errors when a <fetch> is handed to a consumer that wants a <filter>", () => {
    const found = diagnose(`lookup.addCustomFilter("<fetch><entity name='account' /></fetch>", "account");`, "typescript");
    expect(found.find((d) => d.code === "wrongRoot")?.severity).toBe("error");
  });

  it("errors on an aggregate query in a consumer that rejects them", () => {
    const found = diagnoseQuery({
      root: rootOf(`<fetch aggregate="true"><entity name="account"><attribute name="accountid" aggregate="count" alias="n" /></entity></fetch>`),
      consumer: consumerById("savedQuery"),
      language: "csharp",
      parameters: [],
    });
    expect(found.map((d) => d.code)).toContain("aggregateRejected");
  });

  it("warns when a URL-bound query is too long", () => {
    const columns = Array.from({ length: 200 }, (_, i) => `<attribute name="column_with_a_long_name_${i}" />`).join("");
    const found = diagnoseQuery({
      root: rootOf(`<fetch><entity name="account">${columns}</entity></fetch>`),
      consumer: consumerById("webApi"),
      language: "typescript",
      parameters: [],
    });
    expect(found.map((d) => d.code)).toContain("urlTooLong");
  });

  it("errors on an aggregate attribute with no alias and warns on one that neither aggregates nor groups", () => {
    const found = diagnoseQuery({
      root: rootOf(`<fetch aggregate="true"><entity name="account"><attribute name="accountid" aggregate="count" /><attribute name="name" /></entity></fetch>`),
      consumer: UNKNOWN_CONSUMER,
      language: "csharp",
      parameters: [],
    });
    expect(found.map((d) => d.code)).toContain("aggregateNeedsAlias");
    expect(found.map((d) => d.code)).toContain("aggregateNeedsGroupBy");
  });

  it("warns that top cannot be combined with paging", () => {
    const found = diagnoseQuery({
      root: rootOf(`<fetch top="10" page="2" count="50"><entity name="account" /></fetch>`),
      consumer: UNKNOWN_CONSUMER,
      language: "csharp",
      parameters: [],
    });
    expect(found.map((d) => d.code)).toContain("topWithPaging");
  });

  it("warns about unknown tables and columns, and stays quiet about correct ones", () => {
    const bad = diagnoseQuery({
      root: rootOf(`<fetch><entity name="nosuchtable"><attribute name="title" /></entity></fetch>`),
      consumer: UNKNOWN_CONSUMER,
      language: "csharp",
      parameters: [],
      metadata,
    });
    expect(bad.map((d) => d.code)).toContain("unknownEntity");

    const worse = diagnoseQuery({
      root: rootOf(`<fetch><entity name="incident"><attribute name="nosuchcolumn" /></entity></fetch>`),
      consumer: UNKNOWN_CONSUMER,
      language: "csharp",
      parameters: [],
      metadata,
    });
    expect(worse.map((d) => d.code)).toContain("unknownAttribute");

    const fine = diagnoseQuery({
      root: rootOf(`<fetch><entity name="incident"><attribute name="title" /></entity></fetch>`),
      consumer: UNKNOWN_CONSUMER,
      language: "csharp",
      parameters: [],
      metadata,
    });
    expect(fine.filter((d) => d.code.startsWith("unknown"))).toEqual([]);
  });

  it("says nothing about names when metadata has not loaded", () => {
    const found = diagnoseQuery({
      root: rootOf(`<fetch><entity name="whatever"><attribute name="mystery" /></entity></fetch>`),
      consumer: UNKNOWN_CONSUMER,
      language: "csharp",
      parameters: [],
    });
    expect(found.filter((d) => d.code.startsWith("unknown"))).toEqual([]);
  });

  it("does not treat a tokenised name as an unknown table", () => {
    const found = diagnoseQuery({ root: rootOf(`<fetch><entity name="@table" /></fetch>`), consumer: UNKNOWN_CONSUMER, language: "csharp", parameters: [], metadata });
    expect(found.map((d) => d.code)).not.toContain("unknownEntity");
  });

  it("mentions all-attributes and a query that selects nothing", () => {
    expect(
      diagnoseQuery({ root: rootOf(`<fetch><entity name="account"><all-attributes /></entity></fetch>`), consumer: UNKNOWN_CONSUMER, language: "csharp", parameters: [] }).map(
        (d) => d.code,
      ),
    ).toContain("allAttributes");
    expect(
      diagnoseQuery({ root: rootOf(`<fetch><entity name="account" /></fetch>`), consumer: UNKNOWN_CONSUMER, language: "csharp", parameters: [] }).map((d) => d.code),
    ).toContain("noColumns");
  });

  it("finds nothing to say about a clean query", () => {
    const found = diagnoseQuery({
      root: rootOf(
        `<fetch top="50"><entity name="incident"><attribute name="title" /><filter><condition attribute="statecode" operator="eq" value="0" /></filter></entity></fetch>`,
      ),
      consumer: consumerById("sdkFetchExpression"),
      language: "csharp",
      parameters: [],
      metadata,
    });
    expect(found).toEqual([]);
  });
});
