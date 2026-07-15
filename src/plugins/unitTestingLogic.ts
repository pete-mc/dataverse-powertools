// Pure, vscode/fs/process-free helpers for the plugin unit-testing feature:
// target-framework compatibility resolution, C# language-version parsing, test
// class-name sanitising, and the per-framework test boilerplate. Extracted from
// unitTesting.ts so this logic can be unit-tested in isolation (#143 Move 3).

export type UnitTestFramework = "mstest" | "xunit" | "nunit";

/** Settings files store forward-slash paths regardless of OS. */
export function normalizePathForSettings(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

/** The `dotnet new` template id for a chosen framework. */
export function getTemplateForFramework(framework: UnitTestFramework): string {
  if (framework === "mstest") {
    return "mstest";
  }
  if (framework === "nunit") {
    return "nunit";
  }
  return "xunit";
}

/** Turn arbitrary user input into a legal C# class identifier (strip illegal
 * chars, prefix `Test` when it would start with a digit); "" when nothing legal
 * remains. */
export function sanitizeClassName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  const cleaned = trimmed.replace(/[^a-zA-Z0-9_]/g, "");
  if (!cleaned) {
    return "";
  }

  if (/^[0-9]/.test(cleaned)) {
    return `Test${cleaned}`;
  }

  return cleaned;
}

/** Per-framework starter test file content. */
export function getTestBoilerplate(framework: UnitTestFramework, namespaceName: string, className: string): string {
  if (framework === "mstest") {
    return `using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace ${namespaceName};

[TestClass]
public class ${className}
{
    [TestMethod]
  public void TODO_Add_DataverseUnitTest_For_Plugin_Execution()
    {
    // TODO: Replace placeholders with your plugin class and DataverseUnitTest setup.
    // TODO: Arrange a DataverseUnitTest context/service provider with target/pre-image data.
    // TODO: Execute the plugin under test and assert expected output/state changes.
    var messageName = "Update";
    var tableLogicalName = "account";

    Assert.IsFalse(string.IsNullOrWhiteSpace(messageName));
    Assert.IsFalse(string.IsNullOrWhiteSpace(tableLogicalName));
    }
}
`;
  }

  if (framework === "nunit") {
    return `using NUnit.Framework;

namespace ${namespaceName};

public class ${className}
{
    [Test]
  public void TODO_Add_DataverseUnitTest_For_Plugin_Execution()
    {
    // TODO: Replace placeholders with your plugin class and DataverseUnitTest setup.
    // TODO: Arrange a DataverseUnitTest context/service provider with target/pre-image data.
    // TODO: Execute the plugin under test and assert expected output/state changes.
    var messageName = "Update";
    var tableLogicalName = "account";

    Assert.That(string.IsNullOrWhiteSpace(messageName), Is.False);
    Assert.That(string.IsNullOrWhiteSpace(tableLogicalName), Is.False);
    }
}
`;
  }

  return `using Xunit;

namespace ${namespaceName};

public class ${className}
{
    [Fact]
  public void TODO_Add_DataverseUnitTest_For_Plugin_Execution()
    {
    // TODO: Replace placeholders with your plugin class and DataverseUnitTest setup.
    // TODO: Arrange a DataverseUnitTest context/service provider with target/pre-image data.
    // TODO: Execute the plugin under test and assert expected output/state changes.
    var messageName = "Update";
    var tableLogicalName = "account";

    Assert.False(string.IsNullOrWhiteSpace(messageName));
    Assert.False(string.IsNullOrWhiteSpace(tableLogicalName));
    }
}
`;
}

/** Parse a classic .NET Framework moniker (`net462` → 462, `net48` → 480);
 * undefined for modern (`net8.0`) or non-framework monikers. */
export function tryParseDotNetFrameworkVersion(targetFramework: string): number | undefined {
  const match = targetFramework
    .trim()
    .toLowerCase()
    .match(/^net(\d{2,3})$/);
  if (!match) {
    return undefined;
  }

  const numeric = match[1];
  if (numeric.length === 2) {
    return Number.parseInt(numeric, 10) * 10;
  }

  return Number.parseInt(numeric, 10);
}

/** True for a modern SDK-style moniker like `net8.0` (runnable test host). */
export function isRunnableModernDotNetTargetFramework(targetFramework: string): boolean {
  return /^net\d+\.\d+$/.test(targetFramework.trim().toLowerCase());
}

/** Pick a test-project target framework compatible with the plugin's: classic
 * frameworks below 4.7.2 bump to net472; modern monikers pass through;
 * netstandard maps to net8.0. */
export function resolveCompatibleTestTargetFramework(pluginTargetFramework: string): string {
  const normalizedTargetFramework = pluginTargetFramework.trim().toLowerCase();
  const parsedFrameworkVersion = tryParseDotNetFrameworkVersion(normalizedTargetFramework);
  if (parsedFrameworkVersion !== undefined) {
    return parsedFrameworkVersion < 472 ? "net472" : normalizedTargetFramework;
  }

  if (isRunnableModernDotNetTargetFramework(normalizedTargetFramework)) {
    return normalizedTargetFramework;
  }

  if (normalizedTargetFramework.startsWith("netstandard")) {
    return "net8.0";
  }
  return pluginTargetFramework;
}

/** Parse a C# `<LangVersion>` numeric value (`10` → 100, `7.3` → 73); undefined
 * for non-numeric values like `latest` / `preview`. */
export function tryParseCSharpLanguageVersion(value: string): number | undefined {
  const normalized = value.trim().toLowerCase();
  const numericMatch = normalized.match(/^(\d+)(\.\d+)?$/);
  if (!numericMatch) {
    return undefined;
  }

  const major = Number.parseInt(numericMatch[1], 10);
  const minor = numericMatch[2] ? Number.parseInt(numericMatch[2].replace(".", ""), 10) : 0;
  return major * 10 + minor;
}
