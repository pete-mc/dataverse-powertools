using Microsoft.Xrm.Sdk;
using System;
EARLYBOUNDUSINGPLACEHOLDER
namespace NAMESPACEPLACEHOLDER
{
    /// <summary>
    /// Plugin development guide: https://docs.microsoft.com/powerapps/developer/common-data-service/plug-ins
    /// Best practices and guidance: https://docs.microsoft.com/powerapps/developer/common-data-service/best-practices/business-logic/
    /// </summary>
    public class CLASSNAMEPLACEHOLDER : PluginBase
    {
        public CLASSNAMEPLACEHOLDER(string unsecureConfiguration, string secureConfiguration)
            : base(typeof(CLASSNAMEPLACEHOLDER))
        {
            // TODO: Implement your custom configuration handling
            // https://docs.microsoft.com/powerapps/developer/common-data-service/register-plug-in#set-configuration-data
        }

        // Entry point for custom business logic execution
        protected override void ExecuteDataversePlugin(ILocalPluginContext localPluginContext)
        {
            if (localPluginContext == null)
            {
                throw new ArgumentNullException(nameof(localPluginContext));
            }

            var context = localPluginContext.PluginExecutionContext;

            // TODO: Implement your custom business logic.

            // Most plugins act on the record that triggered them. Bail out early if there isn't one.
            if (!(context.InputParameters.Contains("Target") && context.InputParameters["Target"] is Entity target))
            {
                return;
            }

            // ---------------------------------------------------------------------------------
            // Example A - LATE-BOUND (no generated types needed; works against any table)
            // ---------------------------------------------------------------------------------
            //if (target.LogicalName == "account")
            //{
            //    var name = target.GetAttributeValue<string>("name");
            //    // Writing back onto the Target in a pre-operation update is the cheapest way to
            //    // change the record being saved - no extra service call.
            //    target["description"] = $"Touched by CLASSNAMEPLACEHOLDER: {name}";
            //}

            // ---------------------------------------------------------------------------------
            // Example B - EARLY-BOUND (uses the generated types)
            // Run "Generate Earlybound" first (this adds the classes under the component's
            // generated/ folder and makes the using above resolve), then uncomment.
            // ---------------------------------------------------------------------------------
            //var service = localPluginContext.PluginUserService;
            //var account = target.ToEntity<Account>();
            //using (var svc = new SERVICECONTEXTPLACEHOLDER(service))
            //{
            //    var stored = svc.AccountSet.FirstOrDefault(a => a.Id == account.Id);
            //    if (stored != null)
            //    {
            //        stored.Description = $"Touched by CLASSNAMEPLACEHOLDER: {stored.Name}";
            //        svc.UpdateObject(stored);
            //        svc.SaveChanges();
            //    }
            //}
        }
    }
}
