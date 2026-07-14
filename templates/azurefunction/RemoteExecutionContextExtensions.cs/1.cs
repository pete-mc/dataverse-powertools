using System.Runtime.Serialization.Json;
using System.Text;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Xrm.Sdk;

namespace AzureFunction.Dataverse;

/// <summary>
/// Deserialization of the webhook payload into the typed <see cref="RemoteExecutionContext"/>.
///
/// Dataverse serializes the context with the DataContract JSON serializer (the payload carries
/// <c>__type</c> annotations for the Xrm.Sdk types inside InputParameters / entity images), so it
/// is read back the same way, with those types declared as known types.
/// </summary>
public static class RemoteExecutionContextExtensions
{
    private static readonly Type[] KnownTypes =
    {
        typeof(Entity),
        typeof(EntityReference),
        typeof(EntityCollection),
        typeof(EntityReferenceCollection),
        typeof(AttributeCollection),
        typeof(FormattedValueCollection),
        typeof(KeyAttributeCollection),
        typeof(ParameterCollection),
        typeof(EntityImageCollection),
        typeof(OptionSetValue),
        typeof(OptionSetValueCollection),
        typeof(Money),
        typeof(AliasedValue),
        typeof(Label),
        typeof(LocalizedLabel),
        typeof(BooleanManagedProperty),
    };

    private static readonly DataContractJsonSerializer Serializer = new(typeof(RemoteExecutionContext), KnownTypes);

    /// <summary>Read the request body as the well-known Dataverse <see cref="RemoteExecutionContext"/>.</summary>
    public static async Task<RemoteExecutionContext> ReadRemoteExecutionContextAsync(this HttpRequestData request)
    {
        using var reader = new StreamReader(request.Body, Encoding.UTF8);
        var body = await reader.ReadToEndAsync();
        return DeserializeRemoteExecutionContext(body);
    }

    /// <summary>Deserialize a raw webhook payload (useful in unit tests with a captured payload).</summary>
    public static RemoteExecutionContext DeserializeRemoteExecutionContext(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            throw new InvalidOperationException("The webhook request body was empty — expected a RemoteExecutionContext payload.");
        }

        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));
        return Serializer.ReadObject(stream) as RemoteExecutionContext
            ?? throw new InvalidOperationException("The webhook request body could not be read as a RemoteExecutionContext.");
    }
}
