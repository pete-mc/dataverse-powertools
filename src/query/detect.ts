// Find the FetchXML in a source file (#238) — the entry point the CodeLens provider calls.
//
// Chains together the pure pieces: scan the file for string literals and `+` chains, keep the ones
// that look like a query, swap interpolations for `@token` placeholders, and parse. A span is only
// reported when the result parses with a `<fetch>` or `<filter>` root, which is what keeps
// StringBuilder fragments, embedded XML payloads and passing mentions of "<fetch" out.
//
// Pure (no `vscode`) → unit-tested.

import { Consumer, detectConsumer } from "./consumers";
import { HoleToken, tokenizeParts } from "./holes";
import { CodeString, Language, LiteralForm, StringPart, partsText, scanLanguage } from "./literals";
import { ParseResult, parseFetchXml } from "./fetchXml";
import { QueryNode } from "./queryModel";

/** Cheap whole-file gate: no `<fetch`/`<filter` anywhere means no work to do. */
const CANDIDATE_PATTERN = /<\s*(fetch|filter)[\s>/]/i;

export interface DetectedQuery {
  /** Offsets of the span to replace on write-back — the whole literal or concatenation chain. */
  start: number;
  end: number;
  language: Language;
  form: LiteralForm;
  /** False when the span can't be faithfully re-emitted; the generator opens read-only. */
  writable: boolean;
  /** The query with interpolations replaced by `@token` placeholders. */
  xml: string;
  tokens: HoleToken[];
  root: QueryNode;
  consumer: Consumer;
  /** The original code parts, kept so a no-op save can be recognised. */
  parts: StringPart[];
}

function isCandidate(text: string): boolean {
  return CANDIDATE_PATTERN.test(text);
}

/** Every FetchXML query in the source, in document order. */
export function detectQueries(source: string, language: Language): DetectedQuery[] {
  if (!isCandidate(source)) {
    return [];
  }

  const detected: DetectedQuery[] = [];
  for (const found of scanLanguage(source, language)) {
    const query = toQuery(source, found, language);
    if (query) {
      detected.push(query);
    }
  }
  return detected;
}

function toQuery(source: string, found: CodeString, language: Language): DetectedQuery | undefined {
  if (!isCandidate(partsText(found.parts))) {
    return undefined;
  }
  const { xml, tokens } = tokenizeParts(found.parts);
  const parsed = parseFetchXml(xml);
  if (!parsed.ok) {
    return undefined;
  }
  return {
    start: found.start,
    end: found.end,
    language,
    form: found.form,
    writable: found.writable,
    xml,
    tokens,
    root: parsed.root,
    consumer: detectConsumer(source, found.start, found.end, language),
    parts: found.parts,
  };
}

/** The query containing `offset`, or the first one after it — what "at the cursor" means. */
export function queryAtOffset(queries: readonly DetectedQuery[], offset: number): DetectedQuery | undefined {
  return queries.find((query) => offset >= query.start && offset <= query.end) ?? queries.find((query) => query.start >= offset);
}

/** Re-parse a candidate query string, exposed so callers can validate edited XML the same way. */
export function reparse(xml: string): ParseResult {
  return parseFetchXml(xml);
}
