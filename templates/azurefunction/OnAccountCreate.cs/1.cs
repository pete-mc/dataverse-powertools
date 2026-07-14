using System.Net;
using AzureFunction.Dataverse;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Entity = Microsoft.Xrm.Sdk.Entity;

namespace AzureFunction;

/// <summary>
/// Sample Dataverse webhook handler. Register it with
/// "Dataverse PowerTools: Register Webhook &amp; Step" — that creates the Webhook (service
/// endpoint) pointing at this function's URL and the SDK message-processing step that fires it.
/// </summary>
public class OnAccountCreate
{
    private readonly ILogger<OnAccountCreate> _logger;
    private readonly IDataverseServiceClientFactory _serviceClientFactory;

    public OnAccountCreate(ILogger<OnAccountCreate> logger, IDataverseServiceClientFactory serviceClientFactory)
    {
        _logger = logger;
        _serviceClientFactory = serviceClientFactory;
    }

    [Function("OnAccountCreate")]
    public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData request)
    {
        // The typed well-known object the step delivers — no raw JSON parsing.
        RemoteExecutionContext context = await request.ReadRemoteExecutionContextAsync();

        _logger.LogInformation(
            "Dataverse webhook: {MessageName} of {PrimaryEntityName} (stage {Stage}, mode {Mode}, depth {Depth}, correlation {CorrelationId})",
            context.MessageName,
            context.PrimaryEntityName,
            context.Stage,
            context.Mode,
            context.Depth,
            context.CorrelationId);

        Entity? target = context.Target;
        if (target is null)
        {
            _logger.LogWarning("No Target entity in InputParameters — nothing to do.");
            return request.CreateResponse(HttpStatusCode.NoContent);
        }

        // Typed attribute access. With early-bound classes generated ("Generate Earlybound"),
        // `target.ToEntity<Account>()` gives you strongly-typed properties instead.
        var name = target.GetAttributeValue<string>("name");
        _logger.LogInformation("Target {LogicalName} {Id} name='{Name}'", target.LogicalName, target.Id, name);

        // Callback into Dataverse (Microsoft.PowerPlatform.Dataverse.Client). The connection comes
        // from the DataverseConnectionString app setting.
        using var service = _serviceClientFactory.Create();
        _logger.LogInformation("Connected to Dataverse organization {Organization}", service.ConnectedOrgFriendlyName);

        // e.g. service.Update(new Entity(target.LogicalName, target.Id) { ["description"] = "Seen by the webhook" });

        return request.CreateResponse(HttpStatusCode.NoContent);
    }
}
