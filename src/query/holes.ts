// Interpolation ⇄ `@token` mapping (#238).
//
// A parameterised FetchXML string isn't valid XML, so before parsing we swap every code
// interpolation for an `@token` placeholder and remember the original expression text. On the way
// back the exact expression text is restored, which is why we never need to understand it.
//
//   $@"…value='{accountId}'…"   ->   …value='@accountId'…      (parse, edit, run)
//   …value='@accountId'…        ->   $@"…value='{accountId}'…"  (write back)
//
// `@` was chosen over `{{…}}` because `{{…}}` is literally Liquid in the Power Pages target, and
// because it matches OData's own `@parameter` alias syntax.
//
// Pure (no `vscode`) → unit-tested.

import { StringPart } from "./literals";

export interface HoleToken {
  /** The placeholder as it appears in the XML, including the `@`. */
  token: string;
  /** Bare name, without the `@`. */
  name: string;
  /** The original code expression, written back verbatim. */
  expression: string;
}

/**
 * A token is only recognised when it is NOT preceded by a word character, so an email address in a
 * value (`value="a@b.com"`) is never mistaken for a parameter — a false positive there would
 * rewrite someone's literal data into an interpolation.
 *
 * Built fresh per call rather than shared: a `/g` regex carries `lastIndex`, and one shared instance
 * across these functions would be mutable state that a nested scan could corrupt.
 */
function tokenPattern(): RegExp {
  return /(^|[^A-Za-z0-9_@])@([A-Za-z_][A-Za-z0-9_]*)/g;
}

/** Strip a C# alignment/format specifier: `{since:yyyy-MM-dd}` names itself after `since`. */
function withoutFormatSpecifier(expression: string): string {
  let depth = 0;
  for (let i = 0; i < expression.length; i++) {
    const char = expression[i];
    if (char === "(" || char === "[") {
      depth++;
    } else if (char === ")" || char === "]") {
      depth--;
    } else if (depth === 0 && (char === ":" || char === ",")) {
      return expression.slice(0, i);
    }
  }
  return expression;
}

/** Words that are never a useful parameter name. */
const NOT_A_NAME = new Set([
  "new",
  "this",
  "base",
  "await",
  "typeof",
  "nameof",
  "null",
  "true",
  "false",
  "var",
  "let",
  "const",
  "string",
  "int",
  "Guid",
  "DateTime",
  "Date",
  "Convert",
  "System",
]);

/**
 * Derive a readable token name from a code expression, so the XML reads `value='@accountId'` rather
 * than `value='@p1'`.
 *
 * The rule: take the last identifier that is NOT immediately followed by `(` — a called name
 * describes the operation, while the identifier beside it names the value. That gives `accountId`
 * from `accountId`, `UserId` from `context.UserId`, `since` from `since.toISOString()` and `name`
 * from `Escape(name)`. Anything with no usable identifier falls back to `p1`, `p2`.
 */
export function identifierFrom(expression: string, fallbackIndex: number): string {
  const bare = withoutFormatSpecifier(expression).trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(bare)) {
    return bare;
  }

  // Blank out string contents first: a name lifted from inside a literal (`dict["some key"]`)
  // describes nothing.
  const scannable = bare.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, (quoted) => " ".repeat(quoted.length));

  const candidates: string[] = [];
  const pattern = /[A-Za-z_][A-Za-z0-9_]*/g;
  for (let match = pattern.exec(scannable); match !== null; match = pattern.exec(scannable)) {
    const isCall = scannable[pattern.lastIndex] === "(";
    if (!isCall && !NOT_A_NAME.has(match[0])) {
      candidates.push(match[0]);
    }
  }
  return candidates.length > 0 ? (candidates.pop() as string) : `p${fallbackIndex}`;
}

/**
 * Replace holes with `@token` placeholders, producing parseable XML. Identical expressions share
 * one token, so a value used twice becomes one parameter prompted for once.
 */
export function tokenizeParts(parts: StringPart[]): { xml: string; tokens: HoleToken[] } {
  const tokens: HoleToken[] = [];
  const byExpression = new Map<string, HoleToken>();
  const usedNames = new Set<string>();
  let fallbackIndex = 1;
  let xml = "";

  for (const part of parts) {
    if (part.kind === "text") {
      xml += part.value;
      continue;
    }
    const existing = byExpression.get(part.expression);
    if (existing) {
      xml += existing.token;
      continue;
    }
    let name = identifierFrom(part.expression, fallbackIndex);
    if (name === `p${fallbackIndex}`) {
      fallbackIndex++;
    }
    if (usedNames.has(name)) {
      let suffix = 2;
      while (usedNames.has(`${name}${suffix}`)) {
        suffix++;
      }
      name = `${name}${suffix}`;
    }
    usedNames.add(name);
    const token: HoleToken = { token: `@${name}`, name, expression: part.expression };
    tokens.push(token);
    byExpression.set(part.expression, token);
    xml += token.token;
  }

  return { xml, tokens };
}

/**
 * Turn XML back into code parts. Known tokens restore their original expression; an `@newName` the
 * user typed in the generator becomes a NEW hole whose expression is that name — so it compiles if
 * such a variable is in scope and fails loudly and locally if it isn't.
 */
export function detokenizeXml(xml: string, tokens: HoleToken[]): StringPart[] {
  const byName = new Map(tokens.map((token) => [token.name, token]));
  const parts: StringPart[] = [];
  let lastIndex = 0;

  const pattern = tokenPattern();
  for (let match = pattern.exec(xml); match !== null; match = pattern.exec(xml)) {
    const [whole, prefix, name] = match;
    const tokenStart = match.index + prefix.length;
    const text = xml.slice(lastIndex, tokenStart);
    if (text.length > 0) {
      parts.push({ kind: "text", value: text });
    }
    parts.push({ kind: "hole", expression: byName.get(name)?.expression ?? name });
    lastIndex = match.index + whole.length;
    // Overlapping matches: the character we consumed as a prefix may start the next token.
    pattern.lastIndex = lastIndex;
  }

  if (lastIndex < xml.length) {
    parts.push({ kind: "text", value: xml.slice(lastIndex) });
  }
  return parts;
}

/**
 * Replace every `@token` in the XML using `resolve`. Returning undefined leaves the token in place.
 * Shared by write-back (token → code expression) and test runs (token → an escaped literal value),
 * so both use exactly the same boundary rules and neither can rewrite an email address.
 */
export function replaceTokens(xml: string, resolve: (name: string) => string | undefined): string {
  let out = "";
  let lastIndex = 0;
  const pattern = tokenPattern();
  for (let match = pattern.exec(xml); match !== null; match = pattern.exec(xml)) {
    const [whole, prefix, name] = match;
    const replacement = resolve(name);
    if (replacement !== undefined) {
      out += xml.slice(lastIndex, match.index + prefix.length) + replacement;
      lastIndex = match.index + whole.length;
    }
    pattern.lastIndex = match.index + whole.length;
  }
  return out + xml.slice(lastIndex);
}

/** Tokens still present in the XML — the generator drops parameters whose condition was deleted. */
export function tokensInXml(xml: string, tokens: HoleToken[]): HoleToken[] {
  return tokens.filter((token) => {
    const pattern = tokenPattern();
    for (let match = pattern.exec(xml); match !== null; match = pattern.exec(xml)) {
      if (match[2] === token.name) {
        return true;
      }
    }
    return false;
  });
}

/** Every `@token` in the XML, known or newly typed, in first-appearance order. */
export function allTokenNames(xml: string): string[] {
  const names: string[] = [];
  const pattern = tokenPattern();
  for (let match = pattern.exec(xml); match !== null; match = pattern.exec(xml)) {
    if (!names.includes(match[2])) {
      names.push(match[2]);
    }
  }
  return names;
}
