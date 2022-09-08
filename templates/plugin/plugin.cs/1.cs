using System;
using System.Linq;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
namespace PluginSRC
{
    // Sample attributes
    // [CrmPluginRegistration(MessageNameEnum.Create, "contact", StageEnum.PostOperation, ExecutionModeEnum.Synchronous, "", "PluginSRC - CLASSNAME - contact Create", 1, IsolationModeEnum.Sandbox, Id = "90705ddd-1442-4403-8cb6-48807e2ecaf7")]
    // [CrmPluginRegistration(MessageNameEnum.Update, "contact", StageEnum.PostOperation, ExecutionModeEnum.Synchronous, "firstname", "PluginSRC - CLASSNAME - contact Update", 1, IsolationModeEnum.Sandbox, Id = "7b205b03-620f-4a9d-aa15-736f6e0e38ae")]
    public class Plugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            ITracingService tracer = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            IPluginExecutionContext context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            IOrganizationServiceFactory factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            IOrganizationService userService = factory.CreateOrganizationService(context.UserId);
            IOrganizationService systemService = factory.CreateOrganizationService(null);
            using (var userServiceContext = new XrmSvc(userService))
            using (var systemServiceContext = new XrmSvc(systemService))
            {
               // Do stuff
           }
        }
    }
}
