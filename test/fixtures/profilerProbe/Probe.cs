using System;
using Microsoft.Xrm.Sdk;

namespace DvptProbe
{
    // Trivial, never-throwing plugin: fires on Create of territory, traces, reads the
    // target. No org calls, so its captured profile replays with no live connection.
    public class ProbePlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            trace.Trace("DVPT probe fired. Message={0} Entity={1} Stage={2}", context.MessageName, context.PrimaryEntityName, context.Stage);
            if (context.InputParameters.Contains("Target") && context.InputParameters["Target"] is Entity target)
            {
                trace.Trace("Target name = {0}", target.GetAttributeValue<string>("name"));
            }
        }
    }
}
