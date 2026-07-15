import { describe, it, expect } from "vitest";
import { esbuildFrontendArgs, frontendOutputName } from "./portalFrontendBuild";

describe("esbuildFrontendArgs", () => {
  it("bundles to a minified, source-mapped browser IIFE web file", () => {
    const args = esbuildFrontendArgs("src/frontend/main.ts", "webfiles/main.js");
    expect(args).toContain("--bundle");
    expect(args).toContain("src/frontend/main.ts");
    expect(args).toContain("--format=iife");
    expect(args).toContain("--target=es2017");
    expect(args).toContain("--minify");
    expect(args).toContain("--sourcemap");
    expect(args).toContain("--outfile=webfiles/main.js");
  });
});

describe("frontendOutputName", () => {
  it("maps a TS/TSX entry to a .js web file", () => {
    expect(frontendOutputName("main.ts")).toBe("main.js");
    expect(frontendOutputName("widget.tsx")).toBe("widget.js");
  });
});
