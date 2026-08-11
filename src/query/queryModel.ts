// The canonical FetchXML document model (#238).
//
// Deliberately UNIFORM: every element is { tag, attrs, children }, with attributes kept as an
// insertion-ordered string map. Nothing is hoisted into typed fields (no `distinct: boolean`, no
// `entity.name`) because this model has to survive a round trip back into a user's SOURCE FILE —
// an attribute we forgot to model would silently disappear from their code the first time they
// saved from the generator. Typed reads go through the accessors at the bottom instead.
//
// Pure (no `vscode`, no I/O) so the parser, the serializer, the generator view-model and the
// write-back self-check all share one definition.

/** Element attributes, in the order they appeared. */
export type Attrs = Record<string, string>;

/** One FetchXML element. `tag` is the literal element name — including `#comment`, which we keep
 * as a node so comments survive a round trip rather than being quietly deleted. */
export interface QueryNode {
  tag: string;
  attrs: Attrs;
  children: QueryNode[];
  /** Text content. Only meaningful for `<value>` and `#comment`. */
  text?: string;
}

export const COMMENT_TAG = "#comment";

/** Tags the generator understands. Anything else is preserved but shown as read-only. */
export const KNOWN_TAGS = ["fetch", "entity", "attribute", "all-attributes", "order", "filter", "condition", "value", "link-entity"] as const;

export function makeNode(tag: string, attrs: Attrs = {}, children: QueryNode[] = []): QueryNode {
  return { tag, attrs, children };
}

/** Deep copy — the generator edits a working copy so "cancel" and the unchanged-model check both work. */
export function cloneNode(node: QueryNode): QueryNode {
  return {
    tag: node.tag,
    attrs: { ...node.attrs },
    children: node.children.map(cloneNode),
    ...(node.text === undefined ? {} : { text: node.text }),
  };
}

export function childrenWithTag(node: QueryNode, tag: string): QueryNode[] {
  return node.children.filter((child) => child.tag === tag);
}

export function firstChildWithTag(node: QueryNode, tag: string): QueryNode | undefined {
  return node.children.find((child) => child.tag === tag);
}

/** Depth-first walk, root included. */
export function walk(node: QueryNode, visit: (node: QueryNode, parents: QueryNode[]) => void, parents: QueryNode[] = []): void {
  visit(node, parents);
  const nextParents = [...parents, node];
  for (const child of node.children) {
    walk(child, visit, nextParents);
  }
}

/** FetchXML booleans are written both `true` and `1`; treat either as set. */
export function attrBool(node: QueryNode, name: string): boolean {
  const raw = node.attrs[name];
  return raw === "true" || raw === "1";
}

/** The `<entity>` of a full query, or undefined for a `<filter>` fragment / a malformed fetch. */
export function queryEntity(root: QueryNode): QueryNode | undefined {
  return root.tag === "fetch" ? firstChildWithTag(root, "entity") : undefined;
}

/** True when the query aggregates — the single biggest per-consumer capability split. */
export function isAggregate(root: QueryNode): boolean {
  return root.tag === "fetch" && attrBool(root, "aggregate");
}

/** Every entity/link-entity node in the query, outermost first — the join list the generator shows. */
export function entityScopes(root: QueryNode): QueryNode[] {
  const scopes: QueryNode[] = [];
  walk(root, (node) => {
    if (node.tag === "entity" || node.tag === "link-entity") {
      scopes.push(node);
    }
  });
  return scopes;
}

/** Structural comparison, used by the write-back self-check ("does re-parsing what we are about
 * to write give the same query?") and by the unchanged-model guard that stops a no-op save from
 * touching the file. Attribute ORDER is deliberately ignored — it carries no meaning — while
 * child order is not, because it is visible in the user's file. */
export function nodesEqual(a: QueryNode, b: QueryNode): boolean {
  if (a.tag !== b.tag || (a.text ?? "") !== (b.text ?? "")) {
    return false;
  }
  const aKeys = Object.keys(a.attrs).sort();
  const bKeys = Object.keys(b.attrs).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, i) => key !== bKeys[i] || a.attrs[key] !== b.attrs[key])) {
    return false;
  }
  return a.children.length === b.children.length && a.children.every((child, i) => nodesEqual(child, b.children[i]));
}
