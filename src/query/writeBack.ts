// Turning an edited query back into source text (#238).
//
// This is the riskiest operation in the feature: a wrong write corrupts code the user has already
// written, which is far worse than anything else here going wrong. So it is guarded, in order:
//
//   1. the edited XML must parse — a malformed query is never written;
//   2. if the resulting code parts are identical to what is already there, report NO CHANGE, so
//      opening the generator and closing it can never produce a diff;
//   3. the literal we are about to emit is re-scanned with the same tokenizer that read it, and the
//      write is REFUSED unless it decodes back to exactly the parts we meant to write.
//
// (3) is the important one. It catches any escaping bug in the encoders as a refusal instead of as
// mangled source, and it costs one extra scan of a few hundred characters.
//
// Pure (no `vscode`) → unit-tested.

import { DetectedQuery } from "./detect";
import { detokenizeXml } from "./holes";
import { Language, StringPart, chooseForm, encodeLiteral, scanLanguage } from "./literals";
import { parseFetchXml } from "./fetchXml";

export type WriteBack = { ok: true; changed: false } | { ok: true; changed: true; text: string } | { ok: false; reason: string };

function partsEqual(a: readonly StringPart[], b: readonly StringPart[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (part, i) =>
        part.kind === b[i].kind && (part.kind === "text" ? part.value === (b[i] as { value: string }).value : part.expression === (b[i] as { expression: string }).expression),
    )
  );
}

/**
 * Compute the replacement source text for a detected query whose XML has been edited. `editedXml`
 * still contains `@token` placeholders; known ones restore their original code expression and new
 * ones become new interpolations.
 */
export function computeWriteBack(query: DetectedQuery, editedXml: string): WriteBack {
  if (!query.writable) {
    return { ok: false, reason: "This string can't be rewritten safely (a raw string literal), so it is read-only." };
  }

  const parsed = parseFetchXml(editedXml);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.error };
  }

  const parts = detokenizeXml(editedXml, query.tokens);
  if (partsEqual(parts, query.parts)) {
    return { ok: true, changed: false };
  }

  const form = chooseForm(query.language, query.form, parts);
  const text = encodeLiteral(query.language, parts, form);

  const verified = verifyEncoding(text, parts, query.language);
  if (!verified) {
    return { ok: false, reason: "Refusing to write: the generated string did not read back identically. Please report this query on the issue tracker." };
  }

  return { ok: true, changed: true, text };
}

/** Re-scan an emitted literal and confirm it decodes to the parts we intended. */
export function verifyEncoding(text: string, parts: readonly StringPart[], language: Language): boolean {
  const rescanned = scanLanguage(text, language);
  return rescanned.length === 1 && rescanned[0].start === 0 && rescanned[0].end === text.length && partsEqual(rescanned[0].parts, parts);
}

/**
 * Build a literal for a brand-new query, for "insert at cursor". `indent` is the leading whitespace
 * of the cursor's line so a multi-line query lines up with the code around it.
 */
export function buildInsertion(xml: string, language: Language, indent = ""): string {
  const indented = indent.length === 0 ? xml : xml.split("\n").join(`\n${indent}`);
  const parts: StringPart[] = [{ kind: "text", value: indented }];
  const form = chooseForm(language, language === "csharp" ? "verbatim" : "template", parts);
  return encodeLiteral(language, parts, form);
}
