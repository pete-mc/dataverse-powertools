import { describe, it, expect } from "vitest";
import { buildTestFilterArgs, shouldRunSelection, buildDotnetTestArgs, testRunStateFor } from "./testRunArgs";

// The Test Explorer's run path had its TRX parsing tested (parseTrx) and its debug launch config
// tested (debugLaunchConfig), but not the command in between — which is where "run this one test"
// can quietly become "run all of them".

describe("buildTestFilterArgs", () => {
  it("omits the filter for a whole-suite run", () => {
    expect(buildTestFilterArgs({})).toEqual([]);
  });

  it("targets a single test by fully-qualified name", () => {
    expect(buildTestFilterArgs({ fqns: ["Contoso.Plugins.Tests.AccountTests.CreatesTask"] })).toEqual([
      "--filter",
      "FullyQualifiedName=Contoso.Plugins.Tests.AccountTests.CreatesTask",
    ]);
  });

  // VSTest reads `|` as OR. `&` would be AND — a filter no test can satisfy, so the run reports
  // nothing ran rather than failing outright.
  it("joins several tests with the OR operator", () => {
    expect(buildTestFilterArgs({ fqns: ["A.B.One", "A.B.Two"] })).toEqual(["--filter", "FullyQualifiedName=A.B.One|FullyQualifiedName=A.B.Two"]);
  });

  // `--filter ""` is not "no tests" to VSTest — it is every test.
  it("omits the flag entirely rather than emitting an empty filter string", () => {
    expect(buildTestFilterArgs({ fqns: [] })).toEqual([]);
    expect(buildTestFilterArgs({ fqns: ["", "  "] })).toEqual([]);
  });

  it("ignores blank names among real ones", () => {
    expect(buildTestFilterArgs({ fqns: ["A.B.One", ""] })).toEqual(["--filter", "FullyQualifiedName=A.B.One"]);
  });
});

describe("shouldRunSelection", () => {
  it("runs when nothing specific was selected — that is the run-everything case", () => {
    expect(shouldRunSelection({})).toBe(true);
  });

  it("runs when the selection names real tests", () => {
    expect(shouldRunSelection({ fqns: ["A.B.One"] })).toBe(true);
  });

  // The trap this guard exists for: a selection with no resolvable names would produce no --filter,
  // and `dotnet test` with no filter runs the entire suite.
  it("does NOT run when a selection resolved to no test names", () => {
    expect(shouldRunSelection({ fqns: [] })).toBe(false);
    expect(shouldRunSelection({ fqns: ["  "] })).toBe(false);
  });
});

describe("buildDotnetTestArgs", () => {
  const base = { testProject: "C:/ws/Plugins.Tests/Plugins.Tests.csproj", trxName: "results.trx", resultsDirectory: "C:/tmp/dvpt-trx-1" };

  it("writes a TRX to the results directory for a whole-suite run", () => {
    expect(buildDotnetTestArgs({ ...base, selection: {} })).toEqual([
      "test",
      "C:/ws/Plugins.Tests/Plugins.Tests.csproj",
      "--logger",
      "trx;LogFileName=results.trx",
      "--results-directory",
      "C:/tmp/dvpt-trx-1",
    ]);
  });

  it("appends the filter for a targeted run", () => {
    const args = buildDotnetTestArgs({ ...base, selection: { fqns: ["A.B.One"] } });
    expect(args.slice(-2)).toEqual(["--filter", "FullyQualifiedName=A.B.One"]);
  });

  // The TRX file name and the directory must agree with where the controller reads the results
  // back from; a mismatch reads as "no test results were produced (build error?)".
  it("names the logger file and the results directory consistently", () => {
    const args = buildDotnetTestArgs({ ...base, selection: {} });
    expect(args[args.indexOf("--logger") + 1]).toBe(`trx;LogFileName=${base.trxName}`);
    expect(args[args.indexOf("--results-directory") + 1]).toBe(base.resultsDirectory);
  });
});

describe("testRunStateFor", () => {
  it("maps the outcomes the Test Explorer draws", () => {
    expect(testRunStateFor("passed")).toBe("passed");
    expect(testRunStateFor("skipped")).toBe("skipped");
    expect(testRunStateFor("failed")).toBe("failed");
  });

  // A result we can't interpret is not evidence the test passed.
  it("treats an unrecognised or missing outcome as a failure", () => {
    expect(testRunStateFor("NotExecuted")).toBe("failed");
    expect(testRunStateFor(undefined)).toBe("failed");
    expect(testRunStateFor("")).toBe("failed");
  });
});
