import { describe, it, expect } from "vitest";
import { parseDotnetListTests } from "./parseDotnetListTests";

const OUT = `Microsoft (R) Test Execution Command Line Tool Version 17.11.0
Copyright (c) Microsoft Corporation.  All rights reserved.

The following Tests are available:
    MyPlugin.Tests.CalcTests.Adds_Two_Numbers
    MyPlugin.Tests.CalcTests.Throws_On_Null
    MyPlugin.Tests.FormatTests.Formats_Currency(1, "GBP")
`;

describe("parseDotnetListTests", () => {
  it("parses fully-qualified names into class + method after the banner", () => {
    const tests = parseDotnetListTests(OUT);
    expect(tests).toHaveLength(3);
    expect(tests[0]).toEqual({ fqn: "MyPlugin.Tests.CalcTests.Adds_Two_Numbers", className: "MyPlugin.Tests.CalcTests", methodName: "Adds_Two_Numbers" });
    // data-driven argument list trimmed to the method
    expect(tests[2]).toEqual({ fqn: "MyPlugin.Tests.FormatTests.Formats_Currency", className: "MyPlugin.Tests.FormatTests", methodName: "Formats_Currency" });
  });

  it("ignores tooling noise and returns [] when there is no banner", () => {
    expect(parseDotnetListTests("Microsoft (R) ...\nno banner here")).toEqual([]);
    expect(parseDotnetListTests("")).toEqual([]);
  });

  it("dedupes repeated names", () => {
    const dup = "The following Tests are available:\n    A.B.C\n    A.B.C\n";
    expect(parseDotnetListTests(dup)).toHaveLength(1);
  });
});
