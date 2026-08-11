// Language dispatch for the literal scanners (#238). Everything above this layer works in terms of
// a `Language` and never knows which reader is behind it, which is what keeps adding a third host
// language (Liquid, for Power Pages) to a single file.

import { CodeString, Language, LiteralForm, StringPart, scanCodeStrings } from "./scan";
import { chooseCsharpForm, csharpReader, encodeCsharp } from "./csharp";
import { chooseTypescriptForm, encodeTypescript, typescriptReader } from "./typescript";

export * from "./scan";
export { csharpReader, encodeCsharp, chooseCsharpForm } from "./csharp";
export { typescriptReader, encodeTypescript, chooseTypescriptForm } from "./typescript";

/** VS Code language ids we can scan, mapped to our two readers. */
const LANGUAGE_IDS: Record<string, Language> = {
  csharp: "csharp",
  typescript: "typescript",
  typescriptreact: "typescript",
  javascript: "typescript",
  javascriptreact: "typescript",
};

/** The scanner for a VS Code `document.languageId`, or undefined when we don't handle it. */
export function languageFor(languageId: string): Language | undefined {
  return LANGUAGE_IDS[languageId];
}

export function scanLanguage(text: string, language: Language): CodeString[] {
  return scanCodeStrings(text, language === "csharp" ? csharpReader : typescriptReader, language);
}

/** The form to write given the author's original form and the new content. */
export function chooseForm(language: Language, original: LiteralForm, parts: StringPart[]): LiteralForm {
  return language === "csharp" ? chooseCsharpForm(original, parts) : chooseTypescriptForm(original, parts);
}

/** Emit source text for the parts — the literal that replaces the original span. */
export function encodeLiteral(language: Language, parts: StringPart[], form: LiteralForm): string {
  return language === "csharp" ? encodeCsharp(parts, form) : encodeTypescript(parts, form);
}
