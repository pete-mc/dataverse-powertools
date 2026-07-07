import { describe, it, expect } from "vitest";
import { stripAnsi, buildOutputHasErrors } from "./buildOutput";

const ESC = String.fromCharCode(27);

describe("stripAnsi", () => {
  it("removes ANSI colour codes", () => {
    expect(stripAnsi(`${ESC}[32msuccess${ESC}[39m`)).toBe("success");
    expect(stripAnsi(`${ESC}[1m${ESC}[33mwarn${ESC}[0m`)).toBe("warn");
  });

  it("leaves plain text untouched, including bracketed text that isn't an escape", () => {
    expect(stripAnsi("no colours here")).toBe("no colours here");
    expect(stripAnsi("array[0m]")).toBe("array[0m]");
  });
});

describe("buildOutputHasErrors", () => {
  it("detects webpack compilation errors", () => {
    expect(buildOutputHasErrors("ERROR in ./src/index.ts\nModule not found")).toBe(true);
    expect(buildOutputHasErrors(`${ESC}[31mERROR in ${ESC}[39m./src/a.ts`)).toBe(true);
  });

  it("does not fire on success output or incidental 'ERROR' text", () => {
    expect(buildOutputHasErrors("webpack compiled successfully")).toBe(false);
    expect(buildOutputHasErrors("0 ERRORS, 0 warnings")).toBe(false);
    expect(buildOutputHasErrors("built C:/path/ERRORHANDLER.js")).toBe(false);
  });
});
