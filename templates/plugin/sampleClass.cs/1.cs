using System;
using System.Linq;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
namespace PluginSRC
{
    // Sample decroation, this will register the below step as part of the publish. Decorations can be added manually or via the Add Plugin Decoration command.
    // They must appear above the class declaration and must be uncommented. A unique GUID is required for each decoration, the builtin command will do this for you.
    // [CrmPluginRegistration(MessageNameEnum.Create, "contact", StageEnum.PostOperation, ExecutionModeEnum.Synchronous, "", "PluginSRC - ClassName - Create", 1, IsolationModeEnum.Sandbox, Id = "90705ddd-1442-4403-8cb6-48807e2ecaf7")]
    public class ClassName : IPlugin
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
