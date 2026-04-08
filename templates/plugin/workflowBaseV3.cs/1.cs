using System;
using System.Activities;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Workflow;

namespace NAMESPACEPLACEHOLDER
{
    /// <summary>
    /// Base class for custom workflow activities.
    /// </summary>
    public abstract class WorkflowBase : CodeActivity
    {
        protected sealed override void Execute(CodeActivityContext executionContext)
        {
            if (executionContext == null)
            {
                throw new InvalidPluginExecutionException(nameof(executionContext));
            }

            var tracingService = executionContext.GetExtension<ITracingService>();
            var workflowContext = executionContext.GetExtension<IWorkflowContext>();
            var serviceFactory = executionContext.GetExtension<IOrganizationServiceFactory>();

            if (workflowContext == null || serviceFactory == null)
            {
                throw new InvalidPluginExecutionException("Workflow context and service factory are required.");
            }

            var userService = serviceFactory.CreateOrganizationService(workflowContext.UserId);
            var systemService = serviceFactory.CreateOrganizationService(null);

            ExecuteDataverseWorkflow(executionContext, tracingService, workflowContext, serviceFactory, userService, systemService);
        }

        protected abstract void ExecuteDataverseWorkflow(
            CodeActivityContext executionContext,
            ITracingService tracingService,
            IWorkflowContext context,
            IOrganizationServiceFactory factory,
            IOrganizationService userService,
            IOrganizationService systemService);
    }
}
