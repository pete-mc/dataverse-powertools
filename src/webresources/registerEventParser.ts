// Pure parser for <PowerTools.RegisterEvent[]> decorations in web-resource TS
// source. Shared by Register Form Events (saveFormData) and the actions panel's
// registrations card (#100 v2). No vscode import — unit-tested directly.

export interface RegisterEventDecoration {
  /** The unique identifier of the form in Dataverse. */
  formId: string;
  /** The event the function is registered on. */
  event: "onload" | "onsave" | string;
  /** Handler in Library.Class.Function format. */
  function: string;
  /** Unique ID (GUID) for the trigger. */
  triggerId: string;
  /** Pass the execution context as the first parameter. */
  executionContext: boolean;
  /** Extra parameters to pass. */
  parameters?: string;
  /** Character offset of the decoration in the source text (for go-to-file). */
  offset: number;
}

export interface ParsedRegisterEvents {
  events: RegisterEventDecoration[];
  /** Number of decoration blocks that failed to parse (malformed JSON). */
  malformedBlocks: number;
}

/** Extract every RegisterEvent decoration from a source text. Lenient: a
 * malformed block is counted, not thrown, so one typo can't hide the rest. */
export function parseRegisterEvents(text: string): ParsedRegisterEvents {
  const events: RegisterEventDecoration[] = [];
  let malformedBlocks = 0;
  const matches = text.matchAll(RegExp(`(?<=<PowerTools\\.RegisterEvent\\[]>).*?(?=;)`, "gs"));
  for (const match of matches) {
    const json = match[0].replace(/,(?=\s*[}\]])/g, "").replace(/(\w+)(?=:)/g, '"$1"');
    try {
      const parsed = JSON.parse(json) as Omit<RegisterEventDecoration, "offset">[];
      for (const event of parsed) {
        events.push({ ...event, offset: match.index ?? 0 });
      }
    } catch {
      malformedBlocks++;
    }
  }
  return { events, malformedBlocks };
}

/** 0-based line number of a character offset in a text. */
export function lineOfOffset(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}
