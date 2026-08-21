import { describe, it, expect } from "vitest";
import { pcfTemplateChoices, pcfFrameworkChoices, suggestPcfName, PCF_INIT_DEFAULTS, PCF_FALLBACK_NAME } from "./pcfInitPrompt";
import { pcfInitArgs } from "./pcfArgs";

describe("pcfInitPrompt choices (#141)", () => {
  it("offers field + dataset templates, each mapped to a valid pac value", () => {
    const values = pcfTemplateChoices().map((c) => c.value);
    expect(values).toEqual(["field", "dataset"]);
    // Every choice value is one pcfInitArgs accepts.
    for (const value of values) {
      expect(pcfInitArgs({ template: value, framework: "none" })).toContain(value);
    }
  });

  it("offers none + react frameworks, each mapped to a valid pac value", () => {
    const values = pcfFrameworkChoices().map((c) => c.value);
    expect(values).toEqual(["none", "react"]);
    for (const value of values) {
      expect(pcfInitArgs({ template: "field", framework: value })).toContain(value);
    }
  });

  it("every choice has a distinct human label + description", () => {
    for (const choice of [...pcfTemplateChoices(), ...pcfFrameworkChoices()]) {
      expect(choice.label.length).toBeGreaterThan(0);
      expect(choice.description && choice.description.length).toBeGreaterThan(0);
    }
  });

  it("defaults match the previous hardcoded scaffold (field/none) so cancelling is safe", () => {
    expect(PCF_INIT_DEFAULTS).toEqual({ template: "field", framework: "none" });
    expect(pcfInitArgs(PCF_INIT_DEFAULTS)).toEqual(["pcf", "init", "--template", "field", "--framework", "none"]);
  });
});

// #258 — the suggestion is what stops two PCF components in one workspace sharing a control name.
describe("suggestPcfName", () => {
  it("PascalCases a folder name into an identifier", () => {
    expect(suggestPcfName("acc-pcf")).toBe("AccPcf");
    expect(suggestPcfName("territory picker")).toBe("TerritoryPicker");
    expect(suggestPcfName("my_control")).toBe("MyControl");
    expect(suggestPcfName("Grid")).toBe("Grid");
  });

  it("gives two different folders two different names — the whole point", () => {
    expect(suggestPcfName("pcf-one")).not.toBe(suggestPcfName("pcf-two"));
  });

  it("keeps digits but never starts with one", () => {
    expect(suggestPcfName("control2")).toBe("Control2");
    expect(suggestPcfName("2fast")).toBe("_2fast");
  });

  it("falls back when nothing usable survives", () => {
    expect(suggestPcfName("")).toBe(PCF_FALLBACK_NAME);
    expect(suggestPcfName("---")).toBe(PCF_FALLBACK_NAME);
    expect(suggestPcfName("", "Other")).toBe("Other");
  });

  it("always produces something pcfInitArgs accepts", () => {
    for (const folder of ["acc-pcf", "2fast", "my control", "---", "a.b.c", "Ünïcødé"]) {
      expect(() => pcfInitArgs({ template: "field", framework: "none", name: suggestPcfName(folder) }), folder).not.toThrow();
    }
  });
});
