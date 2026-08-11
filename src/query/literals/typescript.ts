// TypeScript / JavaScript string-literal reading and writing (#238).
//
// Three forms matter: `'…'`, `"…"` and the template literal `` `…${expr}…` `` — the last being how
// almost all modern web-resource code builds a parameterised FetchXML string.
//
// Regex literals get their own handling: `/["']/` would otherwise open a phantom string and
// desynchronise the whole scan. Telling `/` as division from `/` as a regex needs the previous
// significant character, which is why LiteralReader is handed it.
//
// Pure (no `vscode`) → unit-tested.

import { LiteralForm, LiteralReader, ReadLiteral, StringPart, decodeEscape, hasHoles, readBalancedHole, skipCStyleTrivia } from "./scan";

/** Characters after which a `/` starts a regex rather than dividing. */
const REGEX_PRECEDERS = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "*", "%", "~", "^", "<", ">", "", "\n"]);

function readQuoted(text: string, contentStart: number, quote: '"' | "'"): ReadLiteral | undefined {
  let buffer = "";
  let i = contentStart;
  while (i < text.length) {
    const char = text[i];
    if (char === "\n") {
      return undefined; // a quoted TS string cannot span lines
    }
    if (char === "\\") {
      const decoded = decodeEscape(text, i);
      buffer += decoded.value;
      i = decoded.next;
      continue;
    }
    if (char === quote) {
      const parts: StringPart[] = buffer.length > 0 ? [{ kind: "text", value: buffer }] : [];
      return { end: i + 1, parts, form: quote === "'" ? "single" : "regular", writable: true };
    }
    buffer += char;
    i++;
  }
  return undefined;
}

function readTemplate(text: string, contentStart: number): ReadLiteral | undefined {
  const parts: StringPart[] = [];
  let buffer = "";
  let i = contentStart;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\") {
      const decoded = decodeEscape(text, i);
      buffer += decoded.value;
      i = decoded.next;
      continue;
    }
    if (char === "$" && text[i + 1] === "{") {
      const hole = readBalancedHole(text, i + 2, "}");
      if (!hole) {
        return undefined;
      }
      if (buffer.length > 0) {
        parts.push({ kind: "text", value: buffer });
        buffer = "";
      }
      parts.push({ kind: "hole", expression: hole.expression.trim() });
      i = hole.end;
      continue;
    }
    if (char === "`") {
      if (buffer.length > 0) {
        parts.push({ kind: "text", value: buffer });
      }
      return { end: i + 1, parts, form: "template", writable: true };
    }
    buffer += char;
    i++;
  }
  return undefined;
}

export const typescriptReader: LiteralReader = {
  skipTrivia: skipCStyleTrivia,

  readLiteral(text, i) {
    const char = text[i];
    if (char === '"') {
      return readQuoted(text, i + 1, '"');
    }
    if (char === "'") {
      return readQuoted(text, i + 1, "'");
    }
    if (char === "`") {
      return readTemplate(text, i + 1);
    }
    return undefined;
  },

  readAtomic(text, i, previousSignificant) {
    if (text[i] !== "/" || !REGEX_PRECEDERS.has(previousSignificant)) {
      return undefined;
    }
    // Comments are trivia and already handled; anything else here is a regex body.
    if (text[i + 1] === "/" || text[i + 1] === "*") {
      return undefined;
    }
    let position = i + 1;
    let inClass = false;
    while (position < text.length && text[position] !== "\n") {
      const char = text[position];
      if (char === "\\") {
        position += 2;
        continue;
      }
      if (char === "[") {
        inClass = true;
      } else if (char === "]") {
        inClass = false;
      } else if (char === "/" && !inClass) {
        position++;
        while (position < text.length && /[a-z]/.test(text[position])) {
          position++; // flags
        }
        return position;
      }
      position++;
    }
    return undefined;
  },
};

/**
 * Pick the literal form to write. A template literal is the only TS form that can hold both a
 * newline and a parameter, so any multi-line or parameterised query becomes one; a plain
 * single-line query keeps the author's quote style.
 */
export function chooseTypescriptForm(original: LiteralForm, parts: StringPart[]): LiteralForm {
  const multiline = parts.some((part) => part.kind === "text" && /[\r\n]/.test(part.value));
  if (multiline || hasHoles(parts)) {
    return "template";
  }
  return original === "single" ? "single" : original === "template" ? "template" : "regular";
}

/** Emit TypeScript source for the parts, including delimiters, in the given form. */
export function encodeTypescript(parts: StringPart[], form: LiteralForm): string {
  if (form === "template") {
    const body = parts.map((part) => (part.kind === "hole" ? `\${${part.expression}}` : part.value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${"))).join("");
    return `\`${body}\``;
  }

  const quote = form === "single" ? "'" : '"';
  const body = parts
    .map((part) => {
      if (part.kind === "hole") {
        // Unreachable for a well-formed call — chooseTypescriptForm sends holes to a template —
        // but concatenating keeps the emitted code valid rather than silently dropping a parameter.
        return `${quote} + ${part.expression} + ${quote}`;
      }
      return part.value.replace(/\\/g, "\\\\").replace(new RegExp(quote, "g"), `\\${quote}`).replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
    })
    .join("");
  return `${quote}${body}${quote}`;
}
