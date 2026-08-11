import { describe, it, expect } from "vitest";
import { applyEdit, applyEdits, newFilterFragment, newQuery, nodeAt } from "./edits";
import { ALL_OPERATORS, VALUELESS_OPERATORS, addableFor, buildState, fieldsFor, labelFor, scopeEntity } from "./generatorState";
import { DEFAULT_FORMAT, parseFetchXml, serializeFetchXml } from "./fetchXml";
import { QueryNode } from "./queryModel";

function rootOf(xml: string): QueryNode {
  const parsed = parseFetchXml(xml);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.root;
}

const QUERY = rootOf(`<fetch top="50">
  <entity name="account">
    <attribute name="name" />
    <filter type="and">
      <condition attribute="statecode" operator="eq" value="0" />
    </filter>
  </entity>
</fetch>`);

describe("node paths", () => {
  it("resolves the root and nested nodes", () => {
    expect(nodeAt(QUERY, [])?.tag).toBe("fetch");
    expect(nodeAt(QUERY, [0])?.tag).toBe("entity");
    expect(nodeAt(QUERY, [0, 1, 0])?.tag).toBe("condition");
    expect(nodeAt(QUERY, [0, 9])).toBeUndefined();
  });
});

describe("applying edits", () => {
  it("never mutates the input tree", () => {
    const before = serializeFetchXml(QUERY, DEFAULT_FORMAT);
    applyEdit(QUERY, { kind: "setAttr", path: [], name: "top", value: "5" });
    expect(serializeFetchXml(QUERY, DEFAULT_FORMAT)).toBe(before);
  });

  it("sets an attribute and selects the edited node", () => {
    const result = applyEdit(QUERY, { kind: "setAttr", path: [0, 1, 0], name: "value", value: "1" });
    expect(nodeAt(result!.root, [0, 1, 0])?.attrs.value).toBe("1");
    expect(result!.selection).toEqual([0, 1, 0]);
  });

  it("clearing a field removes the attribute rather than writing an empty one", () => {
    const result = applyEdit(QUERY, { kind: "setAttr", path: [], name: "top", value: "" });
    expect(nodeAt(result!.root, [])?.attrs.top).toBeUndefined();
    expect(serializeFetchXml(result!.root, DEFAULT_FORMAT)).not.toContain("top");
  });

  it("adds a child and selects it", () => {
    const result = applyEdit(QUERY, { kind: "addChild", path: [0, 1], tag: "condition", attrs: { operator: "eq" } });
    expect(result!.selection).toEqual([0, 1, 1]);
    expect(nodeAt(result!.root, [0, 1, 1])?.attrs.operator).toBe("eq");
  });

  it("adds a <value> with text, as an in condition needs", () => {
    const result = applyEdit(QUERY, { kind: "addChild", path: [0, 1, 0], tag: "value", text: "2" });
    expect(nodeAt(result!.root, [0, 1, 0, 0])?.text).toBe("2");
    expect(serializeFetchXml(result!.root, DEFAULT_FORMAT)).toContain("<value>2</value>");
  });

  it("removes a node and selects its neighbour", () => {
    const twoAttributes = applyEdit(QUERY, { kind: "addChild", path: [0], tag: "attribute", attrs: { name: "accountnumber" } })!.root;
    const result = applyEdit(twoAttributes, { kind: "remove", path: [0, 0] });
    expect(nodeAt(result!.root, [0, 0])?.tag).toBe("filter");
    expect(result!.selection).toEqual([0, 0]);
  });

  it("selects the parent when the last child is removed", () => {
    const result = applyEdit(QUERY, { kind: "remove", path: [0, 1, 0] });
    expect(result!.selection).toEqual([0, 1]);
  });

  it("refuses to remove or move the root", () => {
    expect(applyEdit(QUERY, { kind: "remove", path: [] })).toBeUndefined();
    expect(applyEdit(QUERY, { kind: "move", path: [], offset: 1 })).toBeUndefined();
  });

  it("moves a node within its parent and refuses to move past the ends", () => {
    const moved = applyEdit(QUERY, { kind: "move", path: [0, 0], offset: 1 });
    expect(nodeAt(moved!.root, [0, 0])?.tag).toBe("filter");
    expect(nodeAt(moved!.root, [0, 1])?.tag).toBe("attribute");
    expect(moved!.selection).toEqual([0, 1]);
    expect(applyEdit(QUERY, { kind: "move", path: [0, 0], offset: -1 })).toBeUndefined();
  });

  it("sets text on a value node", () => {
    const withValue = applyEdit(QUERY, { kind: "addChild", path: [0, 1, 0], tag: "value", text: "1" })!.root;
    const result = applyEdit(withValue, { kind: "setText", path: [0, 1, 0, 0], text: "9" });
    expect(nodeAt(result!.root, [0, 1, 0, 0])?.text).toBe("9");
  });

  it("ignores an edit addressing a node that isn't there", () => {
    expect(applyEdit(QUERY, { kind: "setAttr", path: [7], name: "x", value: "1" })).toBeUndefined();
  });

  it("applies a run of edits and stops at the first that fails", () => {
    const result = applyEdits(QUERY, [
      { kind: "setAttr", path: [], name: "top", value: "3" },
      { kind: "setAttr", path: [99], name: "x", value: "1" },
      { kind: "setAttr", path: [], name: "distinct", value: "true" },
    ]);
    expect(result.root.attrs.top).toBe("3");
    expect(result.root.attrs.distinct).toBeUndefined();
  });
});

describe("starting points", () => {
  it("builds a valid new query", () => {
    const xml = serializeFetchXml(newQuery(), DEFAULT_FORMAT);
    expect(parseFetchXml(xml).ok).toBe(true);
    expect(xml).toContain('<entity name="account">');
  });

  it("builds a valid filter fragment for the lookup consumers", () => {
    const root = newFilterFragment();
    expect(root.tag).toBe("filter");
    expect(parseFetchXml(serializeFetchXml(root, DEFAULT_FORMAT)).ok).toBe(true);
  });
});

describe("tree labels", () => {
  it("reads like the query, not like XML", () => {
    expect(labelFor(rootOf(`<fetch top="50" distinct="true" />`))).toBe("top 50 · distinct");
    expect(labelFor(nodeAt(QUERY, [0])!)).toBe("account");
    expect(labelFor(nodeAt(QUERY, [0, 0])!)).toBe("name");
    expect(labelFor(nodeAt(QUERY, [0, 1])!)).toBe("AND");
    expect(labelFor(nodeAt(QUERY, [0, 1, 0])!)).toBe("statecode eq 0");
  });

  it("shows an aggregate with its alias", () => {
    expect(labelFor(rootOf(`<fetch><entity name="a"><attribute name="accountid" aggregate="count" alias="n" /></entity></fetch>`).children[0].children[0])).toBe(
      "count(accountid) as n",
    );
  });

  it("omits the value for an operator that takes none", () => {
    expect(labelFor(rootOf(`<fetch><entity name="a"><filter><condition attribute="name" operator="null" /></filter></entity></fetch>`).children[0].children[0].children[0])).toBe(
      "name null",
    );
  });

  it("lists the values of an in condition", () => {
    const condition = rootOf(
      `<fetch><entity name="a"><filter><condition attribute="statecode" operator="in"><value>0</value><value>1</value></condition></filter></entity></fetch>`,
    ).children[0].children[0].children[0];
    expect(labelFor(condition)).toBe("statecode in 0, 1");
  });

  it("shows a join with its direction and alias", () => {
    const link = rootOf(`<fetch><entity name="account"><link-entity name="contact" from="parentcustomerid" to="accountid" alias="c" link-type="outer" /></entity></fetch>`)
      .children[0].children[0];
    expect(labelFor(link)).toBe("contact as c (outer: parentcustomerid → accountid)");
  });

  it("labels a condition qualified by a link-entity alias", () => {
    const condition = rootOf(`<fetch><entity name="a"><filter><condition entityname="c" attribute="fullname" operator="eq" value="x" /></filter></entity></fetch>`).children[0]
      .children[0].children[0];
    expect(labelFor(condition)).toBe("c.fullname eq x");
  });
});

describe("field and child descriptors", () => {
  it("offers the operators a condition needs, grouped", () => {
    expect(ALL_OPERATORS).toContain("eq");
    expect(ALL_OPERATORS).toContain("last-x-days");
    expect(ALL_OPERATORS).toContain("under");
    expect(new Set(ALL_OPERATORS).size).toBe(ALL_OPERATORS.length);
  });

  it("knows which operators take no value", () => {
    expect(VALUELESS_OPERATORS.has("null")).toBe(true);
    expect(VALUELESS_OPERATORS.has("eq-userid")).toBe(true);
    expect(VALUELESS_OPERATORS.has("eq")).toBe(false);
  });

  it("offers children appropriate to each element", () => {
    expect(addableFor("entity")).toContain("link-entity");
    expect(addableFor("filter")).toEqual(["condition", "filter"]);
    expect(addableFor("attribute")).toEqual([]);
    expect(addableFor("nonsense")).toEqual([]);
  });

  it("describes a condition's fields with a parameter hint", () => {
    const value = fieldsFor("condition").find((field) => field.name === "value");
    expect(value?.hint).toContain("@name");
  });
});

describe("scope resolution for the column picker", () => {
  it("uses the nearest enclosing table", () => {
    const withLink = rootOf(
      `<fetch><entity name="account"><link-entity name="contact" from="parentcustomerid" to="accountid"><attribute name="fullname" /></link-entity></entity></fetch>`,
    );
    expect(scopeEntity(withLink, [0, 0, 0])).toBe("contact");
    expect(scopeEntity(withLink, [0])).toBe("account");
    expect(scopeEntity(withLink, [])).toBeUndefined();
  });
});

describe("assembling generator state", () => {
  const state = buildState({
    root: QUERY,
    format: DEFAULT_FORMAT,
    selection: [0, 1, 0],
    diagnostics: [],
    parameters: [],
    readOnly: false,
    consumerLabel: "FetchExpression (SDK)",
    title: "Plugin.cs",
    dirty: false,
  });

  it("flattens the tree with depth and paths", () => {
    expect(state.tree.map((row) => [row.depth, row.tag])).toEqual([
      [0, "fetch"],
      [1, "entity"],
      [2, "attribute"],
      [2, "filter"],
      [3, "condition"],
    ]);
  });

  it("exposes the selected node's fields with current values", () => {
    expect(state.selectedTag).toBe("condition");
    expect(state.fields.find((field) => field.descriptor.name === "operator")?.value).toBe("eq");
    expect(state.canRemove).toBe(true);
  });

  it("serializes the XML for the preview", () => {
    expect(state.xml).toContain('<condition attribute="statecode" operator="eq" value="0" />');
  });

  it("falls back to the root when the selection no longer resolves", () => {
    const orphaned = buildState({
      root: QUERY,
      format: DEFAULT_FORMAT,
      selection: [5, 5],
      diagnostics: [],
      parameters: [],
      readOnly: false,
      consumerLabel: "x",
      title: "y",
      dirty: false,
    });
    expect(orphaned.selection).toEqual([]);
    expect(orphaned.selectedTag).toBe("fetch");
    expect(orphaned.canRemove).toBe(false);
  });

  it("surfaces attributes the generator has no field for, so nothing looks lost", () => {
    const exotic = buildState({
      root: rootOf(`<fetch latematerialize="true"><entity name="account" /></fetch>`),
      format: DEFAULT_FORMAT,
      selection: [],
      diagnostics: [],
      parameters: [],
      readOnly: false,
      consumerLabel: "x",
      title: "y",
      dirty: false,
    });
    expect(exotic.otherAttributes).toEqual([{ name: "latematerialize", value: "true" }]);
  });

  it("marks a comment node read-only so the generator won't try to edit it", () => {
    const withComment = buildState({
      root: rootOf(`<fetch><!-- note --><entity name="account" /></fetch>`),
      format: DEFAULT_FORMAT,
      selection: [0],
      diagnostics: [],
      parameters: [],
      readOnly: false,
      consumerLabel: "x",
      title: "y",
      dirty: false,
    });
    expect(withComment.tree[1].readOnly).toBe(true);
    expect(withComment.tree[1].label).toBe("comment: note");
  });
});
