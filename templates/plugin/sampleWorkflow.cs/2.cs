using System;
using System.Linq;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using System.Activities;
using Microsoft.Xrm.Sdk.Workflow;

namespace PROJECTNAMESPACE
{
    //[CrmPluginRegistration("WorkflowActivity","ClassName", "Workflow Description", "Workflow Group Name", IsolationModeEnum.Sandbox)]
    public class ClassName : CodeActivity
    {
        [RequiredArgument]
        [Input("Contact")]
        [ReferenceTarget("contact")]
        public InArgument<EntityReference> Contact { get; set; }

        protected override void Execute(CodeActivityContext executionContext)
        {
            ITracingService tracingService = executionContext.GetExtension<ITracingService>();
            IWorkflowContext context = executionContext.GetExtension<IWorkflowContext>();
            IOrganizationServiceFactory factory = executionContext.GetExtension<IOrganizationServiceFactory>();
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