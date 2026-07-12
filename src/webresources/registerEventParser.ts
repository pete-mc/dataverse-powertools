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

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate a decoration BEFORE it reaches the form XML. A missing/blank field
 * used to serialize as an <event> without its required attributes, which
 * Dataverse rejects with a cryptic schema error (0x80048425, "required
 * attribute 'name' is missing"). Returns the problem, or undefined when valid. */
export function validateRegisterEvent(event: Partial<RegisterEventDecoration>): string | undefined {
  if (!event.formId || !GUID_PATTERN.test(event.formId)) {
    return `formId must be a GUID (got "${event.formId ?? ""}")`;
  }
  if (event.event !== "onload" && event.event !== "onsave") {
    return `event must be "onload" or "onsave" (got "${event.event ?? ""}") — attribute onchange events aren't supported by form-level registration`;
  }
  if (!event.function || !event.function.trim()) {
    return "function is required (Library.Class.Function)";
  }
  if (!event.triggerId || !GUID_PATTERN.test(event.triggerId)) {
    return `triggerId must be a GUID (got "${event.triggerId ?? ""}")`;
  }
  return undefined;
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
