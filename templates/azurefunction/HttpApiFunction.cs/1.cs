using System.Net;
using AzureFunction.Dataverse;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace AzureFunction;

/// <summary>
/// A plain HTTP-triggered API endpoint. Not a Dataverse webhook — nothing registers a step
/// against it — but it still gets the Dataverse ServiceClient callback, so it can read and write
/// Dataverse on demand (e.g. an API your portal or a third party calls).
/// </summary>
public class HttpApiFunction
{
    private readonly ILogger<HttpApiFunction> _logger;
    private readonly IDataverseServiceClientFactory _serviceClientFactory;

    public HttpApiFunction(ILogger<HttpApiFunction> logger, IDataverseServiceClientFactory serviceClientFactory)
    {
        _logger = logger;
        _serviceClientFactory = serviceClientFactory;
    }

    [Function("HttpApiFunction")]
    public async Task<HttpResponseData> Run([HttpTrigger(AuthorizationLevel.Function, "get", "post")] HttpRequestData request)
    {
        _logger.LogInformation("HTTP {Method} {Url}", request.Method, request.Url);

        // Callback into Dataverse. The connection comes from the DataverseConnectionString app
        // setting (local.settings.json in dev; Function App settings in Azure).
        using var service = _serviceClientFactory.Create();
        _logger.LogInformation("Connected to Dataverse organization {Organization}", service.ConnectedOrgFriendlyName);

        // TODO: your logic. With early-bound classes generated ("Generate Earlybound") you get
        // strongly-typed entities here, e.g.:
        //   var account = service.Retrieve("account", id, new ColumnSet("name")).ToEntity<Account>();

        var response = request.CreateResponse(HttpStatusCode.OK);
        await response.WriteStringAsync("OK");
        return response;
    }
}
