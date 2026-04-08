using System;
using System.Activities;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Workflow;

namespace Plugin
{
    /// <summary>
    /// Custom workflow activity implementation.

    [CrmPluginRegistration("WorkflowActivity", "Test", "testing", "testing123", IsolationModeEnum.Sandbox)]
    /// </summary>
    public class Test : WorkflowBase
    {
        protected override void ExecuteDataverseWorkflow(
            CodeActivityContext executionContext,
            ITracingService tracingService,
            IWorkflowContext context,
            IOrganizationServiceFactory factory,
            IOrganizationService userService,
            IOrganizationService systemService)
        {
            if (executionContext == null)
            {
                throw new ArgumentNullException(nameof(executionContext));
            }

            // TODO: Implement your custom workflow logic.
            // Example:
            // tracingService?.Trace("Workflow executed for user {0}", context.UserId);
        }
    }
}
