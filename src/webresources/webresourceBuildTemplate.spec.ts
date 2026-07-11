import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Guards the webresource build config against regressing to the fragile setup that broke Build when
// @types/jest wasn't in the project's LOCAL node_modules (hoisted in a nested project / workspace /
// pnpm layout) — see #95. The e2e VM has @types/jest installed, so only this pins the invariants.
const templateDir = path.resolve(__dirname, "..", "..", "templates", "webresources");

describe("webresource build template (#95)", () => {
  it("ships a tsconfig.build.json that drops types and excludes tests", () => {
    const raw = fs.readFileSync(path.join(templateDir, "tsconfig.build.json", "1.json"), "utf8");
    const cfg = JSON.parse(raw);
    expect(cfg.extends).toBe("./tsconfig.json");
    // types:[] → the build needs no @types/jest AND does not auto-scan typeRoots (which would choke
    // on ./typings/XRM). XRM types still load as regular .d.ts in the program.
    expect(cfg.compilerOptions.types).toEqual([]);
    // The production bundle must not type-check Jest tests.
    expect(cfg.exclude).toEqual(expect.arrayContaining(["**/__tests__/**", "**/*.test.ts"]));
  });

  it("points ts-loader at tsconfig.build.json in webpack.common.js", () => {
    const webpack = fs.readFileSync(path.join(templateDir, "webpack.common.js", "1.js"), "utf8");
    expect(webpack).toContain("ts-loader");
    expect(webpack).toContain("tsconfig.build.json");
  });
});
