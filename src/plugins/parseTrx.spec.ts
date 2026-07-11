import { describe, it, expect } from "vitest";
import { parseTrx, parseTrxDuration } from "./parseTrx";

// Real VSTest writes the FULLY-QUALIFIED name into @_testName (verified against a live dotnet test).
const TRX = `<?xml version="1.0" encoding="UTF-8"?>
<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult testId="a1" testName="MyPlugin.Tests.CalcTests.Adds_Two_Numbers" outcome="Passed" duration="00:00:00.0123456" />
    <UnitTestResult testId="b2" testName="MyPlugin.Tests.CalcTests.Throws_On_Null" outcome="Failed" duration="00:00:01.5000000">
      <Output>
        <ErrorInfo>
          <Message>Expected true but was false</Message>
          <StackTrace>at MyPlugin.Tests.CalcTests.Throws_On_Null() in C:\\x\\CalcTests.cs:line 42</StackTrace>
        </ErrorInfo>
      </Output>
    </UnitTestResult>
    <UnitTestResult testId="c3" testName="MyPlugin.Tests.CalcTests.Skipped_One" outcome="NotExecuted" />
  </Results>
  <TestDefinitions>
    <UnitTest id="a1" name="Adds_Two_Numbers"><TestMethod className="MyPlugin.Tests.CalcTests, MyPlugin.Tests" name="Adds_Two_Numbers" /></UnitTest>
    <UnitTest id="b2" name="Throws_On_Null"><TestMethod className="MyPlugin.Tests.CalcTests, MyPlugin.Tests" name="Throws_On_Null" /></UnitTest>
    <UnitTest id="c3" name="Skipped_One"><TestMethod className="MyPlugin.Tests.CalcTests, MyPlugin.Tests" name="Skipped_One" /></UnitTest>
  </TestDefinitions>
</TestRun>`;

describe("parseTrx", () => {
  it("maps outcomes, class names, fqn, duration, and failure detail", () => {
    const results = parseTrx(TRX);
    expect(results).toHaveLength(3);

    const pass = results.find((r) => r.fqn === "MyPlugin.Tests.CalcTests.Adds_Two_Numbers")!;
    expect(pass.outcome).toBe("passed");
    expect(pass.className).toBe("MyPlugin.Tests.CalcTests"); // assembly suffix stripped
    expect(pass.durationMs).toBeCloseTo(12.3456, 3);

    const fail = results.find((r) => r.fqn === "MyPlugin.Tests.CalcTests.Throws_On_Null")!;
    expect(fail.outcome).toBe("failed");
    expect(fail.message).toBe("Expected true but was false");
    expect(fail.stackTrace).toContain("CalcTests.cs:line 42");
    expect(fail.durationMs).toBe(1500);

    expect(results.find((r) => r.fqn.endsWith("Skipped_One"))!.outcome).toBe("skipped");
  });

  it("builds fqn from class when testName is only the method (logger-dependent)", () => {
    const trx = `<TestRun><Results><UnitTestResult testId="x" testName="OnlyMethod" outcome="Passed" /></Results>
      <TestDefinitions><UnitTest id="x"><TestMethod className="Ns.MyClass, Asm" name="OnlyMethod" /></UnitTest></TestDefinitions></TestRun>`;
    expect(parseTrx(trx)[0].fqn).toBe("Ns.MyClass.OnlyMethod");
  });

  it("handles a single result (not an array) and missing sections", () => {
    const single = `<TestRun><Results><UnitTestResult testName="Only" outcome="Passed" /></Results></TestRun>`;
    const r = parseTrx(single);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ testName: "Only", fqn: "Only", outcome: "passed" });
    expect(r[0].className).toBeUndefined();
  });

  it("returns [] on malformed / empty input rather than throwing", () => {
    expect(parseTrx("")).toEqual([]);
    expect(parseTrx("<not-a-trx/>")).toEqual([]);
    expect(parseTrx("<<<")).toEqual([]);
  });
});

describe("parseTrxDuration", () => {
  it("parses HH:MM:SS.fffffff to ms", () => {
    expect(parseTrxDuration("00:00:01.5000000")).toBe(1500);
    expect(parseTrxDuration("00:01:00")).toBe(60000);
    expect(parseTrxDuration("01:00:00.0000000")).toBe(3600000);
  });
  it("is undefined for missing/invalid", () => {
    expect(parseTrxDuration(undefined)).toBeUndefined();
    expect(parseTrxDuration("nope")).toBeUndefined();
  });
});
