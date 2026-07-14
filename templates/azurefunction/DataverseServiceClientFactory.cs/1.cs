using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.PowerPlatform.Dataverse.Client;

namespace AzureFunction.Dataverse;

/// <summary>Creates a connected <see cref="ServiceClient"/> for calling back into Dataverse.</summary>
public interface IDataverseServiceClientFactory
{
    /// <summary>A ready <see cref="ServiceClient"/>. Dispose it when the invocation is done.</summary>
    ServiceClient Create();
}

/// <summary>
/// Builds the Dataverse <see cref="ServiceClient"/> from the <c>DataverseConnectionString</c>
/// app setting — <c>local.settings.json</c> locally, Function App application settings (ideally
/// a Key Vault reference) in Azure. Secrets NEVER live in source or in dataverse-powertools.json.
///
/// Examples:
///   client secret:    AuthType=ClientSecret;Url=https://org.crm.dynamics.com;ClientId=…;ClientSecret=…
///   managed identity: AuthType=ManagedIdentity;Url=https://org.crm.dynamics.com;ClientId=&lt;user-assigned-mi-client-id&gt;
/// </summary>
public class DataverseServiceClientFactory : IDataverseServiceClientFactory
{
    public const string ConnectionStringSetting = "DataverseConnectionString";

    private readonly IConfiguration _configuration;
    private readonly ILogger<DataverseServiceClientFactory> _logger;

    public DataverseServiceClientFactory(IConfiguration configuration, ILogger<DataverseServiceClientFactory> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    public ServiceClient Create()
    {
        var connectionString = _configuration[ConnectionStringSetting];
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException($"App setting '{ConnectionStringSetting}' is not configured.");
        }

        var client = new ServiceClient(connectionString);
        if (!client.IsReady)
        {
            _logger.LogError("Dataverse ServiceClient is not ready: {Error}", client.LastError);
            throw new InvalidOperationException($"Could not connect to Dataverse: {client.LastError}");
        }

        return client;
    }
}
