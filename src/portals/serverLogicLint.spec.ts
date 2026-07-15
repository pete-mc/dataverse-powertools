import { describe, it, expect } from "vitest";
import { lintServerLogic, serverLogicPasses, stripCommentsAndStrings } from "./serverLogicLint";

function patterns(code: string): string[] {
  return lintServerLogic(code).map((f) => f.pattern);
}

describe("lintServerLogic — blocked patterns", () => {
  it("passes a clean ES2023 handler", () => {
    const code = `function get(context) {\n  const total = context.items.reduce((a, b) => a + b, 0);\n  return { total };\n}`;
    const findings = lintServerLogic(code);
    expect(findings).toEqual([]);
    expect(serverLogicPasses(findings)).toBe(true);
  });

  it.each([
    ["import x from 'y';", "import"],
    ["const y = require('y');", "require("],
    ["eval('1+1');", "eval("],
    ["const f = new Function('return 1');", "Function("],
    ["setTimeout(() => {}, 10);", "setTimeout("],
    ["setInterval(() => {}, 10);", "setInterval("],
    ["process.exit(1);", "process.exit"],
    ["const cp = child_process;", "child_process"],
    ["fs.readFileSync('x');", "fs."],
    ["console.log(__dirname);", "__dirname"],
    ["const c = this.constructor;", "this.constructor"],
    ["with (obj) {}", "with("],
    ["delete obj.x;", "delete"],
    ["Object.setPrototypeOf(a, b);", "Object.setPrototypeOf"],
    ["const p = new Proxy(t, h);", "Proxy("],
    ["Reflect.get(o, 'k');", "Reflect."],
    ["Symbol.for('x');", "Symbol.for"],
    ["o.__proto__ = null;", "__proto__"],
    ["debugger;", "debugger"],
  ])("flags %s as blocked (%s)", (code, expected) => {
    const findings = lintServerLogic(code);
    expect(findings.map((f) => f.pattern)).toContain(expected);
    expect(serverLogicPasses(findings)).toBe(false);
  });

  it("reports 1-based line numbers", () => {
    const code = `function get() {\n  return 1;\n}\ndebugger;`;
    const finding = lintServerLogic(code).find((f) => f.pattern === "debugger");
    expect(finding?.line).toBe(4);
  });
});

describe("lintServerLogic — unsupported (browser) APIs", () => {
  it("flags fetch/XMLHttpRequest as unsupported but not blocking", () => {
    const findings = lintServerLogic("const r = await fetch('/x');");
    expect(findings.map((f) => f.pattern)).toContain("fetch(");
    expect(findings.every((f) => f.severity === "unsupported")).toBe(true);
    // unsupported alone still passes the blocked-gate
    expect(serverLogicPasses(findings)).toBe(true);
  });
});

describe("stripCommentsAndStrings — no false positives", () => {
  it("ignores patterns inside line comments", () => {
    expect(patterns("// use eval() here\nreturn 1;")).toEqual([]);
  });

  it("ignores patterns inside block comments", () => {
    expect(patterns("/* debugger and require( */\nreturn 1;")).toEqual([]);
  });

  it("ignores patterns inside string literals", () => {
    expect(patterns('const s = "please do not eval() this";')).toEqual([]);
  });

  it("still preserves line numbers across a multi-line block comment", () => {
    const code = `/*\n line two\n*/\ndebugger;`;
    expect(lintServerLogic(code).find((f) => f.pattern === "debugger")?.line).toBe(4);
  });

  it("stripCommentsAndStrings blanks string contents", () => {
    expect(stripCommentsAndStrings('x = "eval("')).not.toContain("eval(");
  });
});
