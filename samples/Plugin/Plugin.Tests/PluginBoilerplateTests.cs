using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Plugin.Tests;

[TestClass]
public class PluginBoilerplateTests
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
