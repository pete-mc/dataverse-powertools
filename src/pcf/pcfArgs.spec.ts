import { describe, it, expect } from "vitest";
import { pcfInitArgs, pcfPushArgs, isValidPcfName, isValidPcfNamespace } from "./pcfArgs";

describe("pcfInitArgs", () => {
  it("builds field + none", () => {
    expect(pcfInitArgs({ template: "field", framework: "none" })).toEqual(["pcf", "init", "--template", "field", "--framework", "none"]);
  });

  it("builds field + react", () => {
    expect(pcfInitArgs({ template: "field", framework: "react" })).toEqual(["pcf", "init", "--template", "field", "--framework", "react"]);
  });

  it("builds dataset + none", () => {
    expect(pcfInitArgs({ template: "dataset", framework: "none" })).toEqual(["pcf", "init", "--template", "dataset", "--framework", "none"]);
  });

  it("builds dataset + react", () => {
    expect(pcfInitArgs({ template: "dataset", framework: "react" })).toEqual(["pcf", "init", "--template", "dataset", "--framework", "react"]);
  });
});

// #258 — pac defaults to SampleNamespace.SampleControl when these are omitted, so every control
// the extension scaffolded shared one name and the second one deployed over the first.
describe("pcfInitArgs — control name + namespace", () => {
  it("omits both flags entirely when neither is given (the previous behaviour)", () => {
    expect(pcfInitArgs({ template: "field", framework: "none" })).toEqual(["pcf", "init", "--template", "field", "--framework", "none"]);
  });

  it("appends --namespace and --name after the existing flags", () => {
    expect(pcfInitArgs({ template: "field", framework: "none", namespace: "Contoso", name: "TerritoryPicker" })).toEqual([
      "pcf",
      "init",
      "--template",
      "field",
      "--framework",
      "none",
      "--namespace",
      "Contoso",
      "--name",
      "TerritoryPicker",
    ]);
  });

  it("allows either one alone", () => {
    expect(pcfInitArgs({ template: "field", framework: "none", name: "Picker" })).toContain("--name");
    expect(pcfInitArgs({ template: "field", framework: "none", name: "Picker" })).not.toContain("--namespace");
    expect(pcfInitArgs({ template: "field", framework: "none", namespace: "Contoso" })).toContain("--namespace");
  });

  it("accepts a dotted namespace but not a dotted control name", () => {
    expect(pcfInitArgs({ template: "field", framework: "none", namespace: "Contoso.Controls" })).toContain("Contoso.Controls");
    expect(() => pcfInitArgs({ template: "field", framework: "none", name: "Contoso.Picker" })).toThrow(/control name/);
  });

  it("refuses text that is not a legal identifier, rather than putting it on the command line", () => {
    for (const bad of ["My Control", "control;rm -rf /", "2Fast", "", "a-b", "$(whoami)"]) {
      expect(() => pcfInitArgs({ template: "field", framework: "none", name: bad }), bad).toThrow();
    }
    for (const bad of ["Contoso Controls", "Contoso..Controls", ".Contoso", "Contoso.", "2Contoso"]) {
      expect(() => pcfInitArgs({ template: "field", framework: "none", namespace: bad }), bad).toThrow();
    }
  });
});

describe("isValidPcfName / isValidPcfNamespace", () => {
  it("accepts ordinary identifiers and underscores", () => {
    expect(isValidPcfName("Picker")).toBe(true);
    expect(isValidPcfName("_Picker2")).toBe(true);
    expect(isValidPcfNamespace("Contoso")).toBe(true);
    expect(isValidPcfNamespace("Contoso.Controls.V2")).toBe(true);
  });

  it("rejects the shapes pac would reject", () => {
    expect(isValidPcfName("Contoso.Picker")).toBe(false);
    expect(isValidPcfName("2Picker")).toBe(false);
    expect(isValidPcfNamespace("Contoso..Controls")).toBe(false);
    expect(isValidPcfNamespace("")).toBe(false);
  });
});

describe("pcfPushArgs", () => {
  it("builds push with a publisher prefix", () => {
    expect(pcfPushArgs("dev")).toEqual(["pcf", "push", "--publisher-prefix", "dev"]);
  });

  it("passes the exact prefix through", () => {
    expect(pcfPushArgs("contoso")).toEqual(["pcf", "push", "--publisher-prefix", "contoso"]);
  });
});
