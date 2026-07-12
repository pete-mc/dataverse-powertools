import { describe, it, expect } from "vitest";
import { parseJestJson, extractJestJson } from "./parseJestJson";

const JEST = JSON.stringify({
  numTotalTests: 3,
  testResults: [
    {
      name: "/proj/webresources_src/__tests__/Contact.test.ts",
      assertionResults: [
        { title: "sets the banner", ancestorTitles: ["Contact"], status: "passed", duration: 5, location: { line: 10, column: 2 }, failureMessages: [] },
        {
          title: "throws when empty",
          ancestorTitles: ["Contact", "onLoad"],
          status: "failed",
          duration: 8,
          location: { line: 20, column: 4 },
          failureMessages: ["Error: expected 1 to be 2\n    at Object.<anonymous> (Contact.test.ts:21:3)"],
        },
        { title: "todo later", ancestorTitles: ["Contact"], status: "todo", failureMessages: [] },
      ],
    },
  ],
});

describe("parseJestJson", () => {
  it("flattens assertions with status, suite path, duration, location, and failure message", () => {
    const results = parseJestJson(JEST);
    expect(results).toHaveLength(3);

    const pass = results.find((r) => r.title === "sets the banner")!;
    expect(pass.status).toBe("passed");
    expect(pass.file).toContain("Contact.test.ts");
    expect(pass.ancestorTitles).toEqual(["Contact"]);
    expect(pass.durationMs).toBe(5);
    expect(pass.line).toBe(10);

    const fail = results.find((r) => r.title === "throws when empty")!;
    expect(fail.status).toBe("failed");
    expect(fail.ancestorTitles).toEqual(["Contact", "onLoad"]);
    expect(fail.message).toContain("expected 1 to be 2");
    expect(fail.line).toBe(20);

    expect(results.find((r) => r.title === "todo later")!.status).toBe("skipped");
  });

  it("returns [] on malformed / empty input", () => {
    expect(parseJestJson("")).toEqual([]);
    expect(parseJestJson("not json")).toEqual([]);
    expect(parseJestJson("{}")).toEqual([]);
  });
});

describe("extractJestJson", () => {
  it("pulls the JSON object out of noisy stdout", () => {
    const noisy = `(node:1) DeprecationWarning: ...\nconsole.log something\n${JEST}\n`;
    expect(extractJestJson(noisy)).toBe(JEST);
    expect(parseJestJson(extractJestJson(noisy))).toHaveLength(3);
  });
  it("returns empty string when there is no object", () => {
    expect(extractJestJson("no json here")).toBe("");
  });

  it("survives braces in the noise — the ts-jest globals deprecation warning (user report)", () => {
    // The warning prints a config snippet containing `{`, which used to make the
    // first-{-to-last-} slice start inside the warning: parse failed and PASSING
    // runs showed red in the Testing pane.
    const noisy = [
      "ts-jest[ts-jest-transformer] (WARN) Define `ts-jest` config under `globals` is deprecated. Please do",
      "transform: {",
      "    <transform_regex>: ['ts-jest', { /* ts-jest config goes here in Jest */ }],",
      "},",
      "See more at https://kulshekhar.github.io/ts-jest/docs/getting-started/presets#advanced",
      "PASS webresources_src/__tests__/Account.test.ts",
      JEST,
      "",
    ].join("\n");
    expect(extractJestJson(noisy)).toBe(JEST);
    expect(parseJestJson(extractJestJson(noisy))).toHaveLength(3);
  });

  it("ignores a braced console.log line after the report", () => {
    const noisy = `${JEST}\n{"not":"the report"}`;
    expect(extractJestJson(noisy)).toBe(JEST);
  });
});
