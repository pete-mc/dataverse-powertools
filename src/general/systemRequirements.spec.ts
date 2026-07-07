/* eslint-disable @typescript-eslint/naming-convention -- test fixtures use the real npm package key "webpack-cli" */
import { describe, it, expect } from "vitest";
import { parseNpmGlobals } from "./systemRequirements";

describe("parseNpmGlobals", () => {
  it("detects installed globals from npm ls JSON", () => {
    const stdout = JSON.stringify({
      dependencies: {
        jest: { version: "29.0.0" },
        webpack: { version: "5.0.0" },
        "webpack-cli": { version: "5.0.0" },
        typescript: { version: "5.0.0" },
      },
    });
    expect(parseNpmGlobals(stdout)).toEqual({ jest: true, webpack: true, webpackCli: true, typescript: true });
  });

  it("reports missing packages as false", () => {
    const stdout = JSON.stringify({ dependencies: { typescript: { version: "5.0.0" } } });
    expect(parseNpmGlobals(stdout)).toEqual({ jest: false, webpack: false, webpackCli: false, typescript: true });
  });

  it("still parses valid JSON even when npm also printed problems/errors alongside it", () => {
    // npm ls -g exits non-zero on unrelated peer-dep issues but still emits this JSON.
    const stdout = JSON.stringify({
      dependencies: { webpack: { version: "5.0.0" }, "webpack-cli": { version: "5.0.0" } },
      problems: ["invalid: some-unrelated-pkg@1.0.0"],
    });
    expect(parseNpmGlobals(stdout)).toEqual({ jest: false, webpack: true, webpackCli: true, typescript: false });
  });

  it("returns all-false for empty or malformed output", () => {
    const allFalse = { jest: false, webpack: false, webpackCli: false, typescript: false };
    expect(parseNpmGlobals("")).toEqual(allFalse);
    expect(parseNpmGlobals("not json")).toEqual(allFalse);
    expect(parseNpmGlobals("{}")).toEqual(allFalse);
  });
});
