using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using FakeXrmEasy;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Xunit;

namespace plugins_test.Tests
{
    public class CLASSNAMETests
    {
        // Write tests here

        // Sample code
        //
        // [Fact]
        // public void Test_contact()
        // {
        //     var fakedContext = new XrmFakedContext { ProxyTypesAssembly = Assembly.GetExecutingAssembly() };
        //     var fakedService = fakedContext.GetOrganizationService();
        //     fakedContext.ProxyTypesAssembly = Assembly.GetExecutingAssembly();
        //     fakedContext.ProxyTypesAssembly = Assembly.GetAssembly(typeof(contact));

        //     var target = new contact { Id = Guid.NewGuid(), firstname = "bob" };
        //     fakedContext.Initialize(new List<Entity>{ target });
        //     ParameterCollection inputParameters = new ParameterCollection
        //     {
        //         { "Target", target }
        //     };
        //     fakedContext.ExecutePluginWith<CLASSNAME>(inputParameters,null,null,null);
        //     using (var systemServiceContext = new XrmSvc(fakedService))
        //     {
        //         contact returnedSession = systemServiceContext.contactSet.First();
        //         Assert.Equal("bob", returnedSession.firstname);
        //     }
        // }
    }
}
