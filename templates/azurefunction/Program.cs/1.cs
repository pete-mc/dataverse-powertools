using AzureFunction.Dataverse;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

// .NET 8 isolated-worker host. The Dataverse ServiceClient factory is registered as a
// singleton so functions can call back into Dataverse (connection comes from app settings).
var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        services.AddSingleton<IDataverseServiceClientFactory, DataverseServiceClientFactory>();
    })
    .Build();

host.Run();
