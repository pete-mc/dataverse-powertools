import { describe, it, expect } from "vitest";
import { esbuildServerLogicArgs, stripModuleSyntax, serverLogicOutputName } from "./serverLogicBuild";

describe("esbuildServerLogicArgs", () => {
  it("bundles to a single self-contained ES2023 file", () => {
    const args = esbuildServerLogicArgs("src/backend/getWidgets.ts", "out/getWidgets.js");
    expect(args).toContain("--bundle");
    expect(args).toContain("src/backend/getWidgets.ts");
    expect(args).toContain("--format=esm");
    expect(args).toContain("--target=es2023");
    expect(args).toContain("--platform=neutral");
    expect(args).toContain("--outfile=out/getWidgets.js");
  });
});

describe("stripModuleSyntax", () => {
  it("removes a trailing export bookkeeping statement", () => {
    const out = stripModuleSyntax(`function get() { return 1; }\nfunction post() {}\nexport { get, post };\n`);
    expect(out).toContain("function get()");
    expect(out).toContain("function post()");
    expect(out).not.toMatch(/\bexport\b/);
  });

  it("strips the export keyword from top-level declarations", () => {
    const out = stripModuleSyntax(`export function get() {}\nexport const CONST = 1;\nexport async function post() {}`);
    expect(out).toContain("function get()");
    expect(out).toContain("const CONST = 1;");
    expect(out).toContain("async function post()");
    expect(out).not.toMatch(/\bexport\b/);
  });

  it("handles renamed exports (export { x as y })", () => {
    const out = stripModuleSyntax(`function h() {}\nexport { h as get };`);
    expect(out).toContain("function h()");
    expect(out).not.toMatch(/\bexport\b/);
  });

  it("drops export default", () => {
    expect(stripModuleSyntax(`export default function get() {}`)).not.toMatch(/\bexport\b/);
  });

  it("leaves a body that already has no module syntax untouched (aside from trimming)", () => {
    const code = `function get() {\n  return { ok: true };\n}`;
    expect(stripModuleSyntax(code)).toBe(code);
  });
});

describe("serverLogicOutputName", () => {
  it("maps a TS entry to a .serverlogic.js output", () => {
    expect(serverLogicOutputName("getWidgets.ts")).toBe("getWidgets.serverlogic.js");
    expect(serverLogicOutputName("post.mts")).toBe("post.serverlogic.js");
  });
});
