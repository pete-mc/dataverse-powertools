// Structural edits to a query, addressed by node path (#238).
//
// The generator webview never owns the model: it sends an INTENT ("set this attribute", "add a
// condition here") and the host applies it and sends fresh state back. That keeps one source of
// truth, keeps the webview dumb, and — the reason it is worth doing — makes every edit a pure
// function over the model, so the whole generator's behaviour is unit-testable without a webview.
//
// A path is the list of child indices from the root: [] is the root, [0] its first child.
//
// Pure (no `vscode`) → unit-tested.

import { Attrs, QueryNode, cloneNode, makeNode } from "./queryModel";

export type QueryEdit =
  | { kind: "setAttr"; path: number[]; name: string; value?: string }
  | { kind: "addChild"; path: number[]; tag: string; attrs?: Attrs; text?: string }
  | { kind: "remove"; path: number[] }
  | { kind: "setText"; path: number[]; text: string }
  | { kind: "move"; path: number[]; offset: number };

export interface EditResult {
  root: QueryNode;
  /** Where the selection should land afterwards — the added node, or the removed node's neighbour. */
  selection: number[];
}

/** Resolve a path against a tree, or undefined when it doesn't address a node. */
export function nodeAt(root: QueryNode, path: readonly number[]): QueryNode | undefined {
  let node: QueryNode | undefined = root;
  for (const index of path) {
    node = node?.children[index];
  }
  return node;
}

/** Apply an edit to a COPY of the tree; returns undefined when the edit doesn't apply. */
export function applyEdit(root: QueryNode, edit: QueryEdit): EditResult | undefined {
  const next = cloneNode(root);

  if (edit.kind === "remove" || edit.kind === "move") {
    if (edit.path.length === 0) {
      return undefined; // the root is not removable or movable
    }
    const parent = nodeAt(next, edit.path.slice(0, -1));
    const index = edit.path[edit.path.length - 1];
    if (!parent || parent.children[index] === undefined) {
      return undefined;
    }
    if (edit.kind === "remove") {
      parent.children.splice(index, 1);
      const neighbour = Math.min(index, parent.children.length - 1);
      return { root: next, selection: neighbour < 0 ? edit.path.slice(0, -1) : [...edit.path.slice(0, -1), neighbour] };
    }
    const target = index + edit.offset;
    if (target < 0 || target >= parent.children.length) {
      return undefined;
    }
    const [moved] = parent.children.splice(index, 1);
    parent.children.splice(target, 0, moved);
    return { root: next, selection: [...edit.path.slice(0, -1), target] };
  }

  const node = nodeAt(next, edit.path);
  if (!node) {
    return undefined;
  }

  switch (edit.kind) {
    case "setAttr": {
      // An empty value removes the attribute rather than writing `name=""` — the generator's text
      // boxes are cleared to mean "not set", and a stray empty attribute changes query semantics.
      if (edit.value === undefined || edit.value === "") {
        delete node.attrs[edit.name];
      } else {
        node.attrs[edit.name] = edit.value;
      }
      return { root: next, selection: [...edit.path] };
    }
    case "addChild": {
      node.children.push(makeNode(edit.tag, { ...(edit.attrs ?? {}) }, []));
      if (edit.text !== undefined) {
        node.children[node.children.length - 1].text = edit.text;
      }
      return { root: next, selection: [...edit.path, node.children.length - 1] };
    }
    case "setText": {
      node.text = edit.text;
      return { root: next, selection: [...edit.path] };
    }
  }
}

/** Apply a run of edits, stopping at the first that doesn't apply. */
export function applyEdits(root: QueryNode, edits: readonly QueryEdit[]): EditResult {
  let current: EditResult = { root, selection: [] };
  for (const edit of edits) {
    const applied = applyEdit(current.root, edit);
    if (!applied) {
      break;
    }
    current = applied;
  }
  return current;
}

/** A minimal, valid starting query for "new FetchXML query". */
export function newQuery(entity = "account", primaryName = "name"): QueryNode {
  return makeNode("fetch", { top: "50" }, [makeNode("entity", { name: entity }, [makeNode("attribute", { name: primaryName })])]);
}

/** A minimal `<filter>` fragment, for the lookup-filter consumers. */
export function newFilterFragment(): QueryNode {
  return makeNode("filter", { type: "and" }, [makeNode("condition", { attribute: "statecode", operator: "eq", value: "0" })]);
}
