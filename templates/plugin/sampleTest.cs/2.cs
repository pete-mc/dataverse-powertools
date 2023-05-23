using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using FakeXrmEasy;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Xunit;

namespace PROJECTNAMESPACE.Tests
{
    public class ClassNameTest
    {
        [Fact]
        public void Test_contact()
        {
            // Setup fakeContext and fakeService to test agaist            
            var fakedContext = new XrmFakedContext { ProxyTypesAssembly = Assembly.GetExecutingAssembly() };
            var fakedService = fakedContext.GetOrganizationService();
            fakedContext.ProxyTypesAssembly = Assembly.GetExecutingAssembly();

            // // Set inital state of the fakedContext here eg:
            // fakedContext.ProxyTypesAssembly = Assembly.GetAssembly(typeof(contact));
            // var target = new contact { Id = Guid.NewGuid(), firstname = "bob" }; // Set a contact record to have the name bob
            // fakedContext.Initialize(new List<Entity>{ target });
            
            ParameterCollection inputParameters = new ParameterCollection
            {
                // Set input parameters for your class here eg:
                // { "Target", target } //Pass the target contact that was added to the fakedContext to the plugin
            };
            fakedContext.ExecutePluginWith<ClassName>(inputParameters,null,null,null); // Call your class

            // Tests to see if the class has run correctly
            using (var systemServiceContext = new XrmSvc(fakedService))
            {
                // // Check if the fakedContext is correct after the plugin execution eg:
                // contact returnedSession = systemServiceContext.contactSet.First(); // Get the first contact record from the fakeContext
                // Assert.Equal("bob", returnedSession.firstname); // Check that the contact's name is still bob
            }
        }
    }
}
