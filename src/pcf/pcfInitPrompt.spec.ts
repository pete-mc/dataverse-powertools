import { describe, it, expect } from "vitest";
import { pcfTemplateChoices, pcfFrameworkChoices, PCF_INIT_DEFAULTS } from "./pcfInitPrompt";
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
