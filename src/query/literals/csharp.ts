// C# string-literal reading and writing (#238).
//
// Covers the four forms FetchXML actually shows up in — `"…"`, `@"…"`, `$"…"`, `$@"…"` — plus raw
// strings (`"""…"""`, C# 11) which are READ so Run and diagnostics work but never written back:
// their content depends on indentation stripping rules subtle enough that re-emitting one risks
// corrupting the query, and a wrong write is far worse than a disabled button.
//
// Pure (no `vscode`) → unit-tested.

import { LiteralForm, LiteralReader, ReadLiteral, StringPart, decodeEscape, hasHoles, readBalancedHole, skipCStyleTrivia } from "./scan";

/** Read `@"…"` / `$@"…"` — a doubled `""` is one quote, and there are no backslash escapes. */
function readVerbatim(text: string, contentStart: number, interpolated: boolean): ReadLiteral | undefined {
  const parts: StringPart[] = [];
  let buffer = "";
  let i = contentStart;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      if (text[i + 1] === '"') {
        buffer += '"';
        i += 2;
        continue;
      }
      if (buffer.length > 0) {
        parts.push({ kind: "text", value: buffer });
      }
      return { end: i + 1, parts, form: interpolated ? "interpolatedVerbatim" : "verbatim", writable: true };
    }
    if (interpolated && char === "{") {
      if (text[i + 1] === "{") {
        buffer += "{";
        i += 2;
        continue;
      }
      const hole = readBalancedHole(text, i + 1, "}");
      if (!hole) {
        return undefined;
      }
      if (buffer.length > 0) {
        parts.push({ kind: "text", value: buffer });
        buffer = "";
      }
      parts.push({ kind: "hole", expression: hole.expression });
      i = hole.end;
      continue;
    }
    if (interpolated && char === "}" && text[i + 1] === "}") {
      buffer += "}";
      i += 2;
      continue;
    }
    buffer += char;
    i++;
  }
  return undefined; // unterminated
}

/** Read `"…"` / `$"…"` — backslash escapes, and no raw newlines. */
function readRegular(text: string, contentStart: number, interpolated: boolean): ReadLiteral | undefined {
  const parts: StringPart[] = [];
  let buffer = "";
  let i = contentStart;
  while (i < text.length) {
    const char = text[i];
    if (char === "\n") {
      return undefined; // unterminated — a non-verbatim literal cannot span lines
    }
    if (char === "\\") {
      const decoded = decodeEscape(text, i);
      buffer += decoded.value;
      i = decoded.next;
      continue;
    }
    if (char === '"') {
      if (buffer.length > 0) {
        parts.push({ kind: "text", value: buffer });
      }
      return { end: i + 1, parts, form: interpolated ? "interpolated" : "regular", writable: true };
    }
    if (interpolated && char === "{") {
      if (text[i + 1] === "{") {
        buffer += "{";
        i += 2;
        continue;
      }
      const hole = readBalancedHole(text, i + 1, "}");
      if (!hole) {
        return undefined;
      }
      if (buffer.length > 0) {
        parts.push({ kind: "text", value: buffer });
        buffer = "";
      }
      parts.push({ kind: "hole", expression: hole.expression });
      i = hole.end;
      continue;
    }
    if (interpolated && char === "}" && text[i + 1] === "}") {
      buffer += "}";
      i += 2;
      continue;
    }
    buffer += char;
    i++;
  }
  return undefined;
}

/**
 * Read a raw string literal (`"""…"""`). Multi-line raw strings strip the closing delimiter's
 * indentation from every line — replicated here so the XML we parse matches what the compiler
 * sees. Always `writable: false`.
 */
function readRaw(text: string, quoteStart: number, interpolated: boolean): ReadLiteral | undefined {
  let quotes = 0;
  while (text[quoteStart + quotes] === '"') {
    quotes++;
  }
  const delimiter = '"'.repeat(quotes);
  const contentStart = quoteStart + quotes;
  const closeIndex = text.indexOf(delimiter, contentStart);
  if (closeIndex === -1) {
    return undefined;
  }
  let content = text.slice(contentStart, closeIndex);

  // Multi-line form: drop the first and last newline, then dedent by the closing indentation.
  if (content.includes("\n")) {
    const lineStart = text.lastIndexOf("\n", closeIndex);
    const closingIndent = text.slice(lineStart + 1, closeIndex);
    const lines = content
      .replace(/^[^\n]*\n/, "")
      .replace(/\n[^\n]*$/, "")
      .split("\n");
    content = lines.map((line) => (line.startsWith(closingIndent) ? line.slice(closingIndent.length) : line.replace(/^\s+/, ""))).join("\n");
  }

  const parts: StringPart[] = [];
  if (interpolated) {
    let buffer = "";
    let i = 0;
    while (i < content.length) {
      if (content[i] === "{") {
        const hole = readBalancedHole(content, i + 1, "}");
        if (hole) {
          if (buffer.length > 0) {
            parts.push({ kind: "text", value: buffer });
            buffer = "";
          }
          parts.push({ kind: "hole", expression: hole.expression });
          i = hole.end;
          continue;
        }
      }
      buffer += content[i];
      i++;
    }
    if (buffer.length > 0) {
      parts.push({ kind: "text", value: buffer });
    }
  } else if (content.length > 0) {
    parts.push({ kind: "text", value: content });
  }

  return { end: closeIndex + quotes, parts, form: "raw", writable: false };
}

export const csharpReader: LiteralReader = {
  skipTrivia: skipCStyleTrivia,

  readLiteral(text, i) {
    // Prefixes, longest first: $@" / @$" / @" / $""" / $" / """ / "
    if ((text.startsWith('$@"', i) || text.startsWith('@$"', i)) && !text.startsWith('$@"""', i)) {
      return readVerbatim(text, i + 3, true);
    }
    if (text.startsWith('@"', i)) {
      return readVerbatim(text, i + 2, false);
    }
    if (text.startsWith('$"""', i)) {
      return readRaw(text, i + 1, true);
    }
    if (text.startsWith('"""', i)) {
      return readRaw(text, i, false);
    }
    if (text.startsWith('$"', i)) {
      return readRegular(text, i + 2, true);
    }
    if (text.startsWith('"', i)) {
      return readRegular(text, i + 1, false);
    }
    return undefined;
  },

  /** A char literal — `'"'` would otherwise open a phantom string and desynchronise the scan. */
  readAtomic(text, i) {
    if (text[i] !== "'") {
      return undefined;
    }
    let position = i + 1;
    while (position < text.length && position < i + 12) {
      if (text[position] === "\\") {
        position += 2;
        continue;
      }
      if (text[position] === "'") {
        return position + 1;
      }
      position++;
    }
    return undefined;
  },
};

/**
 * Pick the literal form to write. Keeps the author's form when it can still express the content and
 * upgrades only when it cannot: a query that gained a newline needs a verbatim string, one that
 * gained a parameter needs an interpolated one.
 */
export function chooseCsharpForm(original: LiteralForm, parts: StringPart[]): LiteralForm {
  const multiline = parts.some((part) => part.kind === "text" && /[\r\n]/.test(part.value));
  const holes = hasHoles(parts);
  if (multiline) {
    return holes ? "interpolatedVerbatim" : original === "interpolatedVerbatim" || original === "interpolated" ? "interpolatedVerbatim" : "verbatim";
  }
  if (holes) {
    return original === "verbatim" || original === "interpolatedVerbatim" ? "interpolatedVerbatim" : "interpolated";
  }
  return original === "verbatim" || original === "interpolatedVerbatim" ? "verbatim" : "regular";
}

/** Emit C# source for the parts, including delimiters, in the given form. */
export function encodeCsharp(parts: StringPart[], form: LiteralForm): string {
  const verbatim = form === "verbatim" || form === "interpolatedVerbatim";
  const interpolated = form === "interpolated" || form === "interpolatedVerbatim";

  const body = parts
    .map((part) => {
      if (part.kind === "hole") {
        return `{${part.expression}}`;
      }
      let value = part.value;
      if (verbatim) {
        value = value.replace(/"/g, '""');
      } else {
        value = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
      }
      if (interpolated) {
        value = value.replace(/\{/g, "{{").replace(/\}/g, "}}");
      }
      return value;
    })
    .join("");

  const prefix = interpolated ? (verbatim ? "$@" : "$") : verbatim ? "@" : "";
  return `${prefix}"${body}"`;
}
