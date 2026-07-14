import { describe, it, expect } from "vitest";
import { escapeODataString } from "./odata";

describe("escapeODataString", () => {
  it("leaves quote-free values untouched", () => {
    expect(escapeODataString("Account")).toBe("Account");
    expect(escapeODataString("dvpt_MyPlugin.Steps.Create")).toBe("dvpt_MyPlugin.Steps.Create");
  });

  it("doubles a single quote (the OData escape)", () => {
    expect(escapeODataString("O'Brien")).toBe("O''Brien");
  });

  it("doubles every quote, not just the first", () => {
    expect(escapeODataString("'a'b'")).toBe("''a''b''");
  });

  it("produces a literal that can't break out of its surrounding quotes", () => {
    // The injection this exists to stop: a name that closes the literal early.
    const malicious = "x' or name ne '";
    const filter = `name eq '${escapeODataString(malicious)}'`;
    expect(filter).toBe("name eq 'x'' or name ne '''");
    // Every apostrophe in the interpolated segment is doubled → no lone quote to terminate on.
    const interpolated = filter.slice("name eq '".length, -1);
    expect(interpolated.split("'").length % 2).toBe(1); // odd → all quotes balanced/doubled
  });

  it("handles the empty string", () => {
    expect(escapeODataString("")).toBe("");
  });
});
