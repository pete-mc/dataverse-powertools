import { describe, it, expect } from "vitest";
import { parseRegisterEvents, lineOfOffset } from "./registerEventParser";

const decoration = (body: string) => `/** <PowerTools.RegisterEvent[]>${body};*/`;

describe("parseRegisterEvents", () => {
  it("parses a single decoration with unquoted keys and trailing commas", () => {
    const text = [
      "export class ContactForm {",
      decoration(`[{ formId: "abc-123", event: "onload", function: "contoso.ContactForm.onLoad", triggerId: "t-1", executionContext: true, }]`),
      "  static onLoad(): void {}",
      "}",
    ].join("\n");
    const { events, malformedBlocks } = parseRegisterEvents(text);
    expect(malformedBlocks).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0].formId).toBe("abc-123");
    expect(events[0].event).toBe("onload");
    expect(events[0].function).toBe("contoso.ContactForm.onLoad");
    expect(events[0].executionContext).toBe(true);
    expect(lineOfOffset(text, events[0].offset)).toBe(1);
  });

  it("parses multiple events in one block and multiple blocks", () => {
    const text = [
      decoration(
        `[{ formId: "f1", event: "onload", function: "a.B.c", triggerId: "1", executionContext: false }, { formId: "f2", event: "onsave", function: "a.B.d", triggerId: "2", executionContext: false }]`,
      ),
      "code();",
      decoration(`[{ formId: "f3", event: "onload", function: "x.Y.z", triggerId: "3", executionContext: true, parameters: "p" }]`),
    ].join("\n");
    const { events } = parseRegisterEvents(text);
    expect(events).toHaveLength(3);
    expect(events[2].parameters).toBe("p");
    expect(lineOfOffset(text, events[2].offset)).toBe(2);
  });

  it("counts malformed blocks without dropping valid ones", () => {
    const text = [decoration(`[{ formId: "ok", event: "onload", function: "a.B.c", triggerId: "1", executionContext: false }]`), decoration(`[{ not valid }]`)].join("\n");
    const { events, malformedBlocks } = parseRegisterEvents(text);
    expect(events).toHaveLength(1);
    expect(malformedBlocks).toBe(1);
  });

  it("returns empty for source without decorations", () => {
    const { events, malformedBlocks } = parseRegisterEvents("export const x = 1;");
    expect(events).toEqual([]);
    expect(malformedBlocks).toBe(0);
  });
});
