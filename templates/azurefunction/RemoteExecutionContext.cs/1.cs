using System.Runtime.Serialization;
using Microsoft.Xrm.Sdk;

namespace AzureFunction.Dataverse;

/// <summary>
/// Strongly-typed mirror of the well-known Dataverse <c>RemoteExecutionContext</c> — the object a
/// webhook step POSTs to this function. Deserialize it with
/// <see cref="RemoteExecutionContextExtensions.ReadRemoteExecutionContextAsync"/> and read the
/// pipeline data as typed <see cref="Entity"/> values instead of raw JSON:
///
/// <code>
/// var ctx = await req.ReadRemoteExecutionContextAsync();
/// Entity? target = ctx.Target;              // InputParameters["Target"]
/// Entity? preImage = ctx.GetPreImage();     // PreEntityImages["PreImage"]
/// </code>
/// </summary>
[DataContract(Namespace = "http://schemas.microsoft.com/xrm/2011/Contracts")]
public class RemoteExecutionContext
{
    [DataMember]
    public Guid BusinessUnitId { get; set; }

    [DataMember]
    public Guid CorrelationId { get; set; }

    [DataMember]
    public int Depth { get; set; }

    [DataMember]
    public Guid InitiatingUserId { get; set; }

    /// <summary>Pipeline inputs — for a Create/Update step, <c>["Target"]</c> is the <see cref="Entity"/>.</summary>
    [DataMember]
    public ParameterCollection InputParameters { get; set; } = new();

    [DataMember]
    public bool IsExecutingOffline { get; set; }

    [DataMember]
    public bool IsInTransaction { get; set; }

    [DataMember]
    public bool IsOfflinePlayback { get; set; }

    [DataMember]
    public int IsolationMode { get; set; }

    /// <summary>The SDK message that fired the step (Create, Update, Delete, …).</summary>
    [DataMember]
    public string? MessageName { get; set; }

    /// <summary>0 = synchronous, 1 = asynchronous.</summary>
    [DataMember]
    public int Mode { get; set; }

    [DataMember]
    public DateTime OperationCreatedOn { get; set; }

    [DataMember]
    public Guid OperationId { get; set; }

    [DataMember]
    public Guid OrganizationId { get; set; }

    [DataMember]
    public string? OrganizationName { get; set; }

    /// <summary>Pipeline outputs — populated for post-operation steps (e.g. <c>["id"]</c> on Create).</summary>
    [DataMember]
    public ParameterCollection OutputParameters { get; set; } = new();

    [DataMember]
    public EntityReference? OwningExtension { get; set; }

    /// <summary>Post-images registered on the step, keyed by image alias.</summary>
    [DataMember]
    public EntityImageCollection PostEntityImages { get; set; } = new();

    /// <summary>Pre-images registered on the step, keyed by image alias.</summary>
    [DataMember]
    public EntityImageCollection PreEntityImages { get; set; } = new();

    [DataMember]
    public Guid PrimaryEntityId { get; set; }

    /// <summary>Logical name of the table the operation ran against.</summary>
    [DataMember]
    public string? PrimaryEntityName { get; set; }

    [DataMember]
    public Guid RequestId { get; set; }

    [DataMember]
    public string? SecureConfiguration { get; set; }

    [DataMember]
    public ParameterCollection SharedVariables { get; set; } = new();

    /// <summary>10 = pre-validation, 20 = pre-operation, 40 = post-operation.</summary>
    [DataMember]
    public int Stage { get; set; }

    /// <summary>The user the step executes AS (the impersonated/registered user).</summary>
    [DataMember]
    public Guid UserId { get; set; }

    [DataMember]
    public RemoteExecutionContext? ParentContext { get; set; }

    /// <summary><c>InputParameters["Target"]</c> as an <see cref="Entity"/> (null when the message has none).</summary>
    public Entity? Target => GetInputParameter<Entity>("Target");

    /// <summary><c>InputParameters["Target"]</c> as an <see cref="EntityReference"/> (Delete, Assign, …).</summary>
    public EntityReference? TargetReference => GetInputParameter<EntityReference>("Target");

    /// <summary>A typed input parameter, or null when it is absent or of another type.</summary>
    public T? GetInputParameter<T>(string name) where T : class =>
        InputParameters is not null && InputParameters.TryGetValue(name, out var value) ? value as T : null;

    /// <summary>A typed output parameter, or null when it is absent or of another type.</summary>
    public T? GetOutputParameter<T>(string name) where T : class =>
        OutputParameters is not null && OutputParameters.TryGetValue(name, out var value) ? value as T : null;

    /// <summary>A registered pre-image by alias (default alias: "PreImage").</summary>
    public Entity? GetPreImage(string alias = "PreImage") =>
        PreEntityImages is not null && PreEntityImages.TryGetValue(alias, out var image) ? image : null;

    /// <summary>A registered post-image by alias (default alias: "PostImage").</summary>
    public Entity? GetPostImage(string alias = "PostImage") =>
        PostEntityImages is not null && PostEntityImages.TryGetValue(alias, out var image) ? image : null;
}
