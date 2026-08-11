// Shared string-literal / concatenation-chain scanner (#238).
//
// Finding FetchXML in code needs real lexing, not a regex: you cannot tell `"` inside `@"a""b"`
// from a closing quote, or `${`…`}` nesting inside a template literal, without walking the text.
// This module owns the language-INDEPENDENT half — the walk, and the `+` chain logic — and each
// language supplies a reader for its own literal syntax.
//
// The output models all three shapes developers actually write FetchXML in as one thing:
//
//   $"<fetch>…value='{id}'…</fetch>"          one interpolated literal
//   `<fetch>…value='${id}'…</fetch>`          one template literal
//   "<fetch>…value='" + id + "'…</fetch>"     a concatenation chain
//
// All become { parts: [text, hole, text] }. A query assembled with a StringBuilder or across loop
// iterations never yields a complete <fetch>…</fetch> in one span, so it simply isn't found — the
// honest failure mode, rather than a half-parsed query we might mangle on save.
//
// Pure (no `vscode`) → unit-tested.

export type Language = "csharp" | "typescript";

/** How the span was written. Drives how we re-encode it on write-back. */
export type LiteralForm =
  | "regular" // "…"           (C# and TS)
  | "single" // '…'            (TS only)
  | "verbatim" // @"…"          (C#)
  | "interpolated" // $"…"      (C#)
  | "interpolatedVerbatim" // $@"…" / @$"…"
  | "raw" // """…"""            (C# 11)
  | "template" // `…`           (TS)
  | "concat"; // a + chain of the above

export type StringPart = { kind: "text"; value: string } | { kind: "hole"; expression: string };

export interface CodeString {
  /** Offsets into the source of the whole span to replace on write-back. */
  start: number;
  end: number;
  parts: StringPart[];
  form: LiteralForm;
  language: Language;
  /** False when the span cannot be faithfully re-emitted (an interpolated C# raw string). Such a
   * query is still detected — Run and diagnostics work — but the generator opens read-only. */
  writable: boolean;
}

export interface ReadLiteral {
  end: number;
  parts: StringPart[];
  form: LiteralForm;
  writable: boolean;
}

export interface LiteralReader {
  /** Read a literal starting at `i`, or undefined if none starts there. */
  readLiteral(text: string, i: number): ReadLiteral | undefined;
  /** Consume whitespace and comments; return the next significant offset. */
  skipTrivia(text: string, i: number): number;
  /** Consume a token that is neither trivia nor a string but must not be lexed as one — a C# char
   * literal, a TS regex — returning its end offset, or undefined. Without this, `'"'` would open a
   * phantom string and desynchronise the whole scan. */
  readAtomic(text: string, i: number, previousSignificant: string): number | undefined;
}

/** Cap on a single concatenation operand, so a runaway scan can't swallow a whole file. */
const MAX_OPERAND_LENGTH = 400;
/** Cap on chain links — far above any real query, a backstop against pathological input. */
const MAX_CHAIN_PARTS = 500;

const OPERAND_TERMINATORS = new Set(["+", ";", ",", ")", "]", "}"]);

/**
 * Read a non-literal operand of a `+` chain — the `id` in `"a" + id + "b"`. Returns the raw
 * expression text, which is written back verbatim, so it does not need to be understood, only
 * delimited. Bracket depth is tracked and nested strings/comments are skipped so a call like
 * `Escape("a+b")` survives intact.
 */
function readOperand(text: string, start: number, reader: LiteralReader): { end: number; expression: string } | undefined {
  let i = start;
  let depth = 0;
  while (i < text.length && i - start < MAX_OPERAND_LENGTH) {
    const trivia = reader.skipTrivia(text, i);
    if (trivia !== i) {
      i = trivia;
      continue;
    }
    const literal = reader.readLiteral(text, i);
    if (literal) {
      i = literal.end;
      continue;
    }
    const atomic = reader.readAtomic(text, i, text[i - 1] ?? "");
    if (atomic !== undefined) {
      i = atomic;
      continue;
    }
    const char = text[i];
    if (char === "(" || char === "[" || char === "{") {
      depth++;
    } else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) {
        break; // closes the expression we sit inside
      }
      depth--;
    } else if (depth === 0 && OPERAND_TERMINATORS.has(char)) {
      break;
    } else if (char === "\n" && depth === 0) {
      // A bare newline only continues the operand if a `+` follows; otherwise the statement ended.
      const next = reader.skipTrivia(text, i);
      if (text[next] !== "+") {
        break;
      }
    }
    i++;
  }
  const expression = text.slice(start, i).trim();
  return expression.length === 0 ? undefined : { end: start + text.slice(start, i).trimEnd().length, expression };
}

/**
 * Find every string literal and `+` concatenation chain in `text`. Chains are returned as one
 * CodeString spanning the whole expression, because writing back a chain replaces all of it.
 */
export function scanCodeStrings(text: string, reader: LiteralReader, language: Language): CodeString[] {
  const found: CodeString[] = [];
  let i = 0;
  let previousSignificant = "";

  while (i < text.length) {
    const trivia = reader.skipTrivia(text, i);
    if (trivia !== i) {
      i = trivia;
      continue;
    }

    const literal = reader.readLiteral(text, i);
    if (!literal) {
      const atomic = reader.readAtomic(text, i, previousSignificant);
      if (atomic !== undefined) {
        i = atomic;
        previousSignificant = "";
        continue;
      }
      if (!/\s/.test(text[i])) {
        previousSignificant = text[i];
      }
      i++;
      continue;
    }

    // A literal starts here: gather the whole `+` chain hanging off it.
    const start = i;
    const parts: StringPart[] = [...literal.parts];
    let end = literal.end;
    let writable = literal.writable;
    let links = 1;

    for (;;) {
      if (parts.length > MAX_CHAIN_PARTS) {
        writable = false;
        break;
      }
      const afterOperand = reader.skipTrivia(text, end);
      if (text[afterOperand] !== "+") {
        break;
      }
      const afterPlus = reader.skipTrivia(text, afterOperand + 1);
      const nextLiteral = reader.readLiteral(text, afterPlus);
      if (nextLiteral) {
        parts.push(...nextLiteral.parts);
        end = nextLiteral.end;
        writable = writable && nextLiteral.writable;
        links++;
        continue;
      }
      const operand = readOperand(text, afterPlus, reader);
      if (!operand) {
        break;
      }
      parts.push({ kind: "hole", expression: operand.expression });
      end = operand.end;
      links++;
    }

    found.push({ start, end, parts: mergeAdjacentText(parts), form: links > 1 ? "concat" : literal.form, language, writable });
    previousSignificant = "";
    i = end;
  }

  return found;
}

/** Collapse runs of text parts so the XML we hand to the parser is contiguous. */
export function mergeAdjacentText(parts: StringPart[]): StringPart[] {
  const merged: StringPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (part.kind === "text" && last?.kind === "text") {
      merged[merged.length - 1] = { kind: "text", value: last.value + part.value };
    } else {
      merged.push(part);
    }
  }
  return merged;
}

/** The decoded string with holes removed — used only to test whether a span contains FetchXML. */
export function partsText(parts: StringPart[]): string {
  return parts.map((part) => (part.kind === "text" ? part.value : "")).join("");
}

export function hasHoles(parts: StringPart[]): boolean {
  return parts.some((part) => part.kind === "hole");
}

/** Shared by both languages: `// line` and `/* block *​/` comments plus whitespace. */
export function skipCStyleTrivia(text: string, i: number): number {
  let position = i;
  for (;;) {
    while (position < text.length && /\s/.test(text[position])) {
      position++;
    }
    if (text.startsWith("//", position)) {
      const newline = text.indexOf("\n", position);
      position = newline === -1 ? text.length : newline + 1;
      continue;
    }
    if (text.startsWith("/*", position)) {
      const close = text.indexOf("*/", position + 2);
      position = close === -1 ? text.length : close + 2;
      continue;
    }
    return position;
  }
}

/** Read the balanced body of an interpolation hole starting after its opening brace. Nested
 * braces, strings and template literals inside the expression are skipped so `{d[","]}` works. */
export function readBalancedHole(text: string, start: number, closeChar: string): { end: number; expression: string } | undefined {
  let i = start;
  let depth = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"' || char === "'" || char === "`") {
      i = skipSimpleString(text, i);
      continue;
    }
    if (char === "{" || char === "(" || char === "[") {
      depth++;
    } else if (char === ")" || char === "]") {
      depth--;
    } else if (char === closeChar) {
      if (depth === 0) {
        return { end: i + 1, expression: text.slice(start, i) };
      }
      depth--;
    }
    i++;
  }
  return undefined;
}

/** Skip a quoted run, honouring backslash escapes. Used only inside hole expressions. */
function skipSimpleString(text: string, i: number): number {
  const quote = text[i];
  let position = i + 1;
  while (position < text.length) {
    if (text[position] === "\\") {
      position += 2;
      continue;
    }
    if (text[position] === quote) {
      return position + 1;
    }
    position++;
  }
  return text.length;
}

/** Decode one backslash escape at `i` (which points at the backslash). */
export function decodeEscape(text: string, i: number): { value: string; next: number } {
  const char = text[i + 1];
  switch (char) {
    case "n":
      return { value: "\n", next: i + 2 };
    case "r":
      return { value: "\r", next: i + 2 };
    case "t":
      return { value: "\t", next: i + 2 };
    case "b":
      return { value: "\b", next: i + 2 };
    case "f":
      return { value: "\f", next: i + 2 };
    case "v":
      return { value: "\v", next: i + 2 };
    case "0":
      return { value: "\0", next: i + 2 };
    case "\r":
      // A TS line continuation: the newline vanishes.
      return { value: "", next: text[i + 2] === "\n" ? i + 3 : i + 2 };
    case "\n":
      return { value: "", next: i + 2 };
    case "x": {
      const hex = text.slice(i + 2, i + 4);
      return /^[0-9a-fA-F]{2}$/.test(hex) ? { value: String.fromCharCode(parseInt(hex, 16)), next: i + 4 } : { value: "x", next: i + 2 };
    }
    case "u": {
      if (text[i + 2] === "{") {
        const close = text.indexOf("}", i + 3);
        const hex = close === -1 ? "" : text.slice(i + 3, close);
        if (/^[0-9a-fA-F]{1,6}$/.test(hex)) {
          return { value: String.fromCodePoint(parseInt(hex, 16)), next: close + 1 };
        }
        return { value: "u", next: i + 2 };
      }
      const hex = text.slice(i + 2, i + 6);
      return /^[0-9a-fA-F]{4}$/.test(hex) ? { value: String.fromCharCode(parseInt(hex, 16)), next: i + 6 } : { value: "u", next: i + 2 };
    }
    case undefined:
      return { value: "", next: i + 1 };
    default:
      // Covers \\ \" \' \` \$ and anything unrecognised, which drops the backslash.
      return { value: char, next: i + 2 };
  }
}
