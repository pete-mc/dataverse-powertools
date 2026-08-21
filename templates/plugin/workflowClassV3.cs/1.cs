#if NETFRAMEWORK // Custom workflow activities are .NET Framework only (System.Activities has no .NET build),
        // so they are excluded from the test-only target of a multi-targeted project (Dataverse PowerTools #269).
using System;
using System.Activities;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Workflow;

namespace NAMESPACEPLACEHOLDER
{
    /// <summary>
    /// Custom workflow activity implementation.
    /// </summary>
    public class WORKFLOWCLASSNAMEPLACEHOLDER : WorkflowBase
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
#endif
