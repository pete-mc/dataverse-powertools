using AzureFunction.Dataverse;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace AzureFunction;

/// <summary>
/// A scheduled (timer-triggered) function — e.g. a nightly Dataverse sync, a cleanup sweep, or a
/// report. Not a Dataverse webhook: nothing registers a step against it. It still gets the
/// Dataverse ServiceClient callback.
/// </summary>
public class TimerFunction
{
    private readonly ILogger<TimerFunction> _logger;
    private readonly IDataverseServiceClientFactory _serviceClientFactory;

    public TimerFunction(ILogger<TimerFunction> logger, IDataverseServiceClientFactory serviceClientFactory)
    {
        _logger = logger;
        _serviceClientFactory = serviceClientFactory;
    }

    // NCRONTAB: {second} {minute} {hour} {day} {month} {day-of-week}. This runs at 02:00 daily.
    [Function("TimerFunction")]
    public void Run([TimerTrigger("0 0 2 * * *")] TimerInfo timer)
    {
        _logger.LogInformation("Timer fired at {Now}; next due {Next}", DateTime.UtcNow, timer.ScheduleStatus?.Next);

        // Callback into Dataverse. The connection comes from the DataverseConnectionString app
        // setting (local.settings.json in dev; Function App settings in Azure).
        using var service = _serviceClientFactory.Create();
        _logger.LogInformation("Connected to Dataverse organization {Organization}", service.ConnectedOrgFriendlyName);

        // TODO: your scheduled logic — e.g. query records due for processing and update them.
    }
}
