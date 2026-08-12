import { describe, it, expect } from "vitest";
import { isTestFile, isWatchableSource, planBatch, testFilesToRerun } from "./continuousRun";

const TESTS = ["C:\\ws\\webresources_src\\__tests__\\Account.test.ts", "C:\\ws\\webresources_src\\__tests__\\Contact.test.ts"];

describe("isTestFile", () => {
  it("recognises a Jest test in the project's __tests__ folder", () => {
    expect(isTestFile("C:\\ws\\webresources_src\\__tests__\\Account.test.ts")).toBe(true);
    expect(isTestFile("/ws/webresources_src/__tests__/Account.test.ts")).toBe(true);
  });

  it("rejects sources, declarations and non-TypeScript files", () => {
    expect(isTestFile("C:\\ws\\webresources_src\\Account.ts")).toBe(false);
    expect(isTestFile("C:\\ws\\webresources_src\\__tests__\\xrm.d.ts")).toBe(false);
    expect(isTestFile("C:\\ws\\webresources_src\\__tests__\\fixture.json")).toBe(false);
  });
});

describe("isWatchableSource", () => {
  it("watches project TypeScript", () => {
    expect(isWatchableSource("C:\\ws\\webresources_src\\Account.ts")).toBe(true);
  });

  it("ignores build output and dependencies — otherwise every build would trigger a run", () => {
    expect(isWatchableSource("C:\\ws\\node_modules\\lib\\index.ts")).toBe(false);
    expect(isWatchableSource("C:\\ws\\dist\\bundle.ts")).toBe(false);
    expect(isWatchableSource("C:\\ws\\bin\\dvpt_library.js")).toBe(false);
    expect(isWatchableSource("C:\\ws\\webresources_src\\typings\\xrm.d.ts")).toBe(false);
  });
});

describe("testFilesToRerun", () => {
  it("runs only the test you are editing", () => {
    expect(testFilesToRerun(TESTS[0], TESTS)).toEqual([TESTS[0]]);
  });

  it("matches a discovered test regardless of drive-letter casing (Windows reports both)", () => {
    expect(testFilesToRerun("c:\\ws\\webresources_src\\__tests__\\Account.test.ts", TESTS)).toEqual([TESTS[0]]);
  });

  it("runs a brand-new test file that discovery has not caught up with", () => {
    const fresh = "C:\\ws\\webresources_src\\__tests__\\Opportunity.test.ts";
    expect(testFilesToRerun(fresh, TESTS)).toEqual([fresh]);
  });

  it("runs EVERY test when a source file changes — guessing coverage would skip the tests that matter", () => {
    expect(testFilesToRerun("C:\\ws\\webresources_src\\Account.ts", TESTS)).toEqual(TESTS);
  });

  it("ignores a change that cannot affect the tests", () => {
    expect(testFilesToRerun("C:\\ws\\node_modules\\x\\index.ts", TESTS)).toEqual([]);
    expect(testFilesToRerun("C:\\ws\\README.md", TESTS)).toEqual([]);
  });
});

describe("planBatch", () => {
  it("collapses a burst of saves into one run, without duplicates", () => {
    expect(planBatch([TESTS[0], TESTS[0], TESTS[1]], TESTS)).toEqual([TESTS[0], TESTS[1]]);
  });

  it("a source change in the burst widens the run to every test", () => {
    expect(planBatch([TESTS[0], "C:\\ws\\webresources_src\\Shared.ts"], TESTS).sort()).toEqual([...TESTS].sort());
  });

  it("is empty when nothing relevant changed, so no run is started", () => {
    expect(planBatch(["C:\\ws\\bin\\dvpt_library.js"], TESTS)).toEqual([]);
  });
});
