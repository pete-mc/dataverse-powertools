// FetchXML parse ⇄ serialize (#238). The keystone of the feature: because the generator UI and the
// user's source file are two views of one model, this round trip has to be faithful enough that
// re-serializing an untouched query reproduces it.
//
// Parsing uses fast-xml-parser (already a dependency) in `preserveOrder` mode, which yields
// [{ tag: [...children], ":@": { "@_attr": "value" } }]. Serializing is hand-rolled rather than
// XMLBuilder so we control quoting, indentation and self-closing precisely — the output goes back
// into someone's source file, so "close enough" formatting is a diff in their repo.
//
// Pure (no `vscode`) → unit-tested.

import { XMLParser, XMLValidator } from "fast-xml-parser";
import { Attrs, COMMENT_TAG, QueryNode, makeNode } from "./queryModel";

const ATTR_PREFIX = "@_";
const ATTR_KEY = ":@";
const TEXT_KEY = "#text";

/** Roots we accept: a whole query, or a bare `<filter>` — the shape lookup filters take. */
const VALID_ROOTS = ["fetch", "filter"];

export interface ParsedQuery {
  ok: true;
  root: QueryNode;
  /** Formatting of the source text, so a re-serialize keeps the user's existing style. */
  format: XmlFormat;
}

export interface ParseFailure {
  ok: false;
  error: string;
}

export type ParseResult = ParsedQuery | ParseFailure;

export interface XmlFormat {
  /** One indent level, e.g. "  ". Empty string means the source was on one line. */
  indent: string;
  newline: string;
  quote: "'" | '"';
}

export const DEFAULT_FORMAT: XmlFormat = { indent: "  ", newline: "\n", quote: '"' };

/**
 * Infer the formatting of an existing FetchXML string so serializing it back preserves the
 * author's style. Getting this right is what makes "open the generator, change one condition, save"
 * produce a one-line diff instead of reformatting the whole query.
 */
export function detectFormat(xml: string): XmlFormat {
  const newline = xml.includes("\r\n") ? "\r\n" : "\n";
  // Attribute quoting: whichever style the source used more often wins. Single quotes are the
  // norm inside C#/TS literals precisely because they need no escaping there.
  const singles = (xml.match(/=\s*'/g) ?? []).length;
  const doubles = (xml.match(/=\s*"/g) ?? []).length;
  const quote: "'" | '"' = singles > doubles ? "'" : '"';
  // Indent unit: the leading whitespace of the first indented child line.
  const lines = xml.split(/\r?\n/);
  let indent = lines.length > 1 ? "  " : "";
  for (const line of lines.slice(1)) {
    const match = /^([ \t]+)\S/.exec(line);
    if (match) {
      indent = match[1];
      break;
    }
  }
  return { indent, newline, quote };
}

function toNode(raw: Record<string, unknown>): QueryNode | undefined {
  const tag = Object.keys(raw).find((key) => key !== ATTR_KEY);
  if (tag === undefined) {
    return undefined;
  }
  const rawAttrs = (raw[ATTR_KEY] ?? {}) as Record<string, unknown>;
  const attrs: Attrs = {};
  for (const [key, value] of Object.entries(rawAttrs)) {
    // A boolean attribute (`<all-attributes />` style) parses to true; keep it as an empty string
    // so serializing writes the bare name back rather than `="true"`.
    attrs[key.startsWith(ATTR_PREFIX) ? key.slice(ATTR_PREFIX.length) : key] = value === true ? "" : String(value);
  }

  const node = makeNode(tag, attrs);
  const rawChildren = raw[tag];
  if (!Array.isArray(rawChildren)) {
    return node;
  }
  for (const child of rawChildren as Record<string, unknown>[]) {
    if (TEXT_KEY in child && Object.keys(child).length === 1) {
      const text = String(child[TEXT_KEY]);
      node.text = (node.text ?? "") + text;
      continue;
    }
    const childNode = toNode(child);
    if (childNode) {
      // fast-xml-parser models a comment as a node whose only child is its text.
      if (childNode.tag === COMMENT_TAG && childNode.text === undefined) {
        childNode.text = "";
      }
      node.children.push(childNode);
    }
  }
  return node;
}

/** Parse FetchXML (or a `<filter>` fragment) into the canonical model. */
export function parseFetchXml(xml: string): ParseResult {
  const trimmed = xml.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "The query is empty." };
  }
  // XMLParser is lenient — it happily accepts `<fetch><entity></fetch>`. Validate first, both so a
  // typo in hand-written XML gets a real message and so the write-back self-check can rely on
  // malformed text failing to parse.
  const validation = XMLValidator.validate(trimmed, { allowBooleanAttributes: true });
  if (validation !== true) {
    const { msg, line, col } = validation.err;
    return { ok: false, error: `${msg} (line ${line}, column ${col})` };
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    preserveOrder: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    allowBooleanAttributes: true,
    commentPropName: COMMENT_TAG,
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(trimmed);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: "The query is not valid XML." };
  }
  const elements = (parsed as Record<string, unknown>[]).map(toNode).filter((node): node is QueryNode => node !== undefined && node.tag !== COMMENT_TAG);
  if (elements.length === 0) {
    return { ok: false, error: "The query has no elements." };
  }
  const root = elements[0];
  if (!VALID_ROOTS.includes(root.tag)) {
    return { ok: false, error: `Expected a <fetch> or <filter> root, found <${root.tag}>.` };
  }
  return { ok: true, root, format: detectFormat(trimmed) };
}

/** Escape a value for an XML attribute delimited by `quote`. The other quote needs no escaping. */
export function escapeXmlAttribute(value: string, quote: "'" | '"'): string {
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return quote === '"' ? escaped.replace(/"/g, "&quot;") : escaped.replace(/'/g, "&apos;");
}

export function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function serializeNode(node: QueryNode, format: XmlFormat, depth: number, out: string[]): void {
  const pad = format.indent.repeat(depth);
  if (node.tag === COMMENT_TAG) {
    out.push(`${pad}<!--${node.text ?? ""}-->`);
    return;
  }

  const attrs = Object.entries(node.attrs)
    .map(([name, value]) => (value === "" ? ` ${name}` : ` ${name}=${format.quote}${escapeXmlAttribute(value, format.quote)}${format.quote}`))
    .join("");

  const text = node.text ?? "";
  if (node.children.length === 0 && text.length === 0) {
    out.push(`${pad}<${node.tag}${attrs} />`);
    return;
  }
  // A node with text and no elements (a `<value>`) stays on one line.
  if (node.children.length === 0) {
    out.push(`${pad}<${node.tag}${attrs}>${escapeXmlText(text)}</${node.tag}>`);
    return;
  }
  out.push(`${pad}<${node.tag}${attrs}>`);
  for (const child of node.children) {
    serializeNode(child, format, depth + 1, out);
  }
  out.push(`${pad}</${node.tag}>`);
}

/** Serialize the model back to FetchXML. Pass the `format` from `parseFetchXml` to preserve style. */
export function serializeFetchXml(root: QueryNode, format: XmlFormat = DEFAULT_FORMAT): string {
  const out: string[] = [];
  serializeNode(root, format, 0, out);
  // An empty indent means the source was one line; join without newlines so it stays that way.
  return format.indent === "" ? out.join("") : out.join(format.newline);
}

/** Single-line form, used where the query rides in a URL (`?fetchXml=`) and length matters. */
export function minifyFetchXml(root: QueryNode, quote: "'" | '"' = '"'): string {
  return serializeFetchXml(root, { indent: "", newline: "", quote });
}
