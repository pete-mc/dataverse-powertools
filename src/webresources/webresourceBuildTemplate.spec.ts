import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Guards the SHAPE of the webresource build config against regressing to the fragile setup that
// broke Build when @types/jest wasn't in the project's LOCAL node_modules (hoisted in a nested
// project / workspace / pnpm layout) — #95. Cheap and specific: it names the three invariants, so a
// regression says which one moved.
//
// webresourceBuildWithoutJestTypes.spec.ts is the other half — it runs tsc against these same
// templates in a project with no @types/jest at all, proving the shape actually does the job. Keep
// both: this one localises the break, that one proves it is a break.
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
