import { describe, it, expect } from "vitest";
import { bareName, findClassLine, findMethodLine, locateTest } from "./testSourceLocations";

// #252: `dotnet test --list-tests` reports names only, so test items had no uri/range and VS Code could
// not offer "Run/Debug Test at Cursor" or gutter icons. These locate a test in its own source.

const SOURCE = `using Xunit;

namespace Contoso.Tests
{
    // class AccountPluginTests  <- a commented-out decoy
    public class AccountPluginTests
    {
        [Fact]
        public void CreatesTheAccount()
        {
            Assert.True(true);
        }

        [Fact]
        public async Task UpdatesTheAccount()
        {
            await Task.CompletedTask;
        }
    }

    public class ContactPluginTests
    {
        [Fact]
        public void CreatesTheAccount()
        {
            Assert.True(true);
        }
    }
}
`;

describe("bareName", () => {
  it("takes the class off a fully-qualified name", () => {
    expect(bareName("Contoso.Tests.AccountPluginTests")).toBe("AccountPluginTests");
    expect(bareName("AccountPluginTests")).toBe("AccountPluginTests");
    expect(bareName("")).toBe("");
  });
});

describe("findClassLine", () => {
  it("finds the declaration, not a commented-out copy", () => {
    // Line 5 is the comment, line 6 the real declaration (1-based) => index 5.
    expect(findClassLine(SOURCE, "Contoso.Tests.AccountPluginTests")).toBe(5);
  });

  it("does not confuse a class whose name merely contains another", () => {
    const source = "public class Foo {}\npublic class FooTests {}\n";
    expect(findClassLine(source, "FooTests")).toBe(1);
    expect(findClassLine(source, "Foo")).toBe(0);
  });

  it("returns undefined when the class is in another file", () => {
    expect(findClassLine(SOURCE, "Contoso.Tests.NotHere")).toBeUndefined();
    expect(findClassLine(SOURCE, "")).toBeUndefined();
  });
});

describe("findMethodLine", () => {
  it("finds a void test method", () => {
    expect(findMethodLine(SOURCE, "CreatesTheAccount")).toBe(8);
  });

  it("finds an async Task test method", () => {
    expect(findMethodLine(SOURCE, "UpdatesTheAccount")).toBe(14);
  });

  it("searches from a line, so the right class wins when a name repeats", () => {
    const contactClass = findClassLine(SOURCE, "ContactPluginTests") as number;
    // The same method name exists in both classes; from the second class it must find the second one.
    expect(findMethodLine(SOURCE, "CreatesTheAccount", contactClass)).toBeGreaterThan(contactClass);
    expect(findMethodLine(SOURCE, "CreatesTheAccount", contactClass)).not.toBe(8);
  });

  it("returns undefined for a method that is not there", () => {
    expect(findMethodLine(SOURCE, "DeletesTheAccount")).toBeUndefined();
    expect(findMethodLine(SOURCE, "")).toBeUndefined();
  });
});

describe("locateTest", () => {
  it("locates a method inside its class", () => {
    expect(locateTest(SOURCE, "Contoso.Tests.AccountPluginTests", "UpdatesTheAccount")).toEqual({ line: 14 });
  });

  it("locates the class when no method is given", () => {
    expect(locateTest(SOURCE, "Contoso.Tests.AccountPluginTests")).toEqual({ line: 5 });
  });

  it("falls back to the class line when the method cannot be found — the file is still right", () => {
    expect(locateTest(SOURCE, "Contoso.Tests.AccountPluginTests", "NoSuchTest")).toEqual({ line: 5 });
  });

  it("returns undefined when the class is not in this file, so the caller tries the next", () => {
    expect(locateTest(SOURCE, "Contoso.Tests.Elsewhere", "Whatever")).toBeUndefined();
  });
});
