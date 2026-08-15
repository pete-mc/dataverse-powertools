import { TemplatePlaceholder } from "../context";

// Template placeholder substitution — the one definition, no `vscode` import.
//
// This lived inline in three places in generateTemplates.ts (project scaffold, on-demand
// createTemplatedFile, and the destination-path rewrite), each doing
// `data.replace(new RegExp(p.placeholder, "g"), p.value || p.placeholder)`. Two things were wrong
// with that, and both are the kind of bug that produces a subtly corrupt scaffolded file rather
// than an error:
//
// 1. **The placeholder was compiled as a regex.** `/\SOLUTIONPREFIX/g` — the literal written for
//    the project prefix — is not the string "SOLUTIONPREFIX": `\S` is "any non-whitespace
//    character", so the pattern means *any char* followed by "OLUTIONPREFIX", and the match
//    CONSUMES that leading character. It happens to work on the exact token and quietly eats a
//    character anywhere else it matches.
// 2. **Substitution was sequential, so later placeholders re-scanned earlier ones' output.** A
//    value containing another placeholder's token got mangled by the next pass. The current
//    placeholder set survives only because of the order the array happens to be in — e.g. a class
//    named `FormNameHandler` is safe only because ClassName is substituted after FormName.
//
// Both are fixed by treating placeholders as literals and substituting in a SINGLE pass: the scan
// never looks at text it has already emitted, so no value can be corrupted by a later placeholder
// regardless of array order. Longest token wins at a given position, so a placeholder that is a
// prefix of another can't shadow it.

/**
 * Replace every placeholder occurrence in `text`, literally, in one pass.
 *
 * A placeholder with no value (undefined or empty) is left in place — callers rely on that to mean
 * "the user skipped this prompt, leave the token for them to fill in".
 */
export function applyPlaceholders(text: string, placeholders: readonly TemplatePlaceholder[] | undefined): string {
  const tokens = (placeholders ?? []).filter((p) => p?.placeholder);
  if (tokens.length === 0) {
    return text;
  }
  // Longest first so "ClassName" can't consume the start of a longer "ClassNameSuffix" token.
  const ordered = [...tokens].sort((a, b) => b.placeholder.length - a.placeholder.length);

  let out = "";
  let i = 0;
  while (i < text.length) {
    const hit = ordered.find((p) => text.startsWith(p.placeholder, i));
    if (hit) {
      out += hit.value ? hit.value : hit.placeholder;
      i += hit.placeholder.length;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/**
 * The two placeholders every template carries, filled from project settings. Falls back to the
 * token itself when the setting is unset, matching the previous behaviour: a scaffold made before
 * the connection is configured keeps the tokens visible rather than baking in an empty prefix.
 */
export function applyProjectPlaceholders(text: string, settings: { prefix?: string; solutionName?: string }): string {
  return applyPlaceholders(text, [
    { placeholder: "SOLUTIONPREFIX", value: settings.prefix },
    { placeholder: "SOLUTIONPLACEHOLDER", value: settings.solutionName },
  ] as TemplatePlaceholder[]);
}
