import { describe, it, expect } from "vitest";
import { pcfInitArgs, pcfPushArgs } from "./pcfArgs";

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

describe("pcfPushArgs", () => {
  it("builds push with a publisher prefix", () => {
    expect(pcfPushArgs("dev")).toEqual(["pcf", "push", "--publisher-prefix", "dev"]);
  });

  it("passes the exact prefix through", () => {
    expect(pcfPushArgs("contoso")).toEqual(["pcf", "push", "--publisher-prefix", "contoso"]);
  });
});
