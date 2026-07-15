// Pure builder for a sample Dataverse webhook payload — a `RemoteExecutionContext`
// in the exact DataContractJson wire format the platform POSTs (#145 #7). This is
// what the scaffolded function's `ReadRemoteExecutionContextAsync` deserializes,
// so a locally-POSTed sample exercises the real handler without a live trigger.
// Format is taken verbatim from the official docs:
//   https://learn.microsoft.com/power-apps/developer/data-platform/use-webhooks
// No `vscode` import → unit-tested.

/* eslint-disable @typescript-eslint/naming-convention */

export interface SampleContextOptions {
  messageName: string;
  primaryEntityName: string;
  /** Target entity attributes (logical name → value). */
  targetAttributes?: Record<string, unknown>;
  /** Pipeline stage — 40 = PostOperation (default). */
  stage?: number;
  /** Execution mode — 1 = Asynchronous (default), 0 = Synchronous. */
  mode?: number;
  /** Epoch ms for the date fields (deterministic; default 0). */
  timestampMs?: number;
}

// DataContractJson type discriminators the SDK emits.
const ENTITY_TYPE = "Entity:http://schemas.microsoft.com/xrm/2011/Contracts";

// Fixed, valid-hex placeholder GUIDs (a test trigger doesn't need real ids).
const PRIMARY_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const BUSINESS_UNIT_ID = "33333333-3333-3333-3333-333333333333";
const ORG_ID = "44444444-4444-4444-4444-444444444444";
const STEP_ID = "55555555-5555-5555-5555-555555555555";

function attributeArray(attributes: Record<string, unknown>): { key: string; value: unknown }[] {
  return Object.entries(attributes).map(([key, value]) => ({ key, value }));
}

function entity(logicalName: string, id: string, attributes: Record<string, unknown>): Record<string, unknown> {
  return {
    __type: ENTITY_TYPE,
    Attributes: attributeArray(attributes),
    EntityState: null,
    FormattedValues: [],
    Id: id,
    KeyAttributes: [],
    LogicalName: logicalName,
    RelatedEntities: [],
    RowVersion: null,
  };
}

/** Build a sample `RemoteExecutionContext` JSON object in the platform's wire format. */
export function buildSampleRemoteExecutionContext(opts: SampleContextOptions): Record<string, unknown> {
  const date = `/Date(${opts.timestampMs ?? 0})/`;
  const target = entity(opts.primaryEntityName, PRIMARY_ID, opts.targetAttributes ?? {});

  return {
    BusinessUnitId: BUSINESS_UNIT_ID,
    CorrelationId: "66666666-6666-6666-6666-666666666666",
    Depth: 1,
    InitiatingUserId: USER_ID,
    InputParameters: [{ key: "Target", value: target }],
    IsExecutingOffline: false,
    IsInTransaction: false,
    IsOfflinePlayback: false,
    IsolationMode: 1,
    MessageName: opts.messageName,
    Mode: opts.mode ?? 1,
    OperationCreatedOn: date,
    OperationId: "77777777-7777-7777-7777-777777777777",
    OrganizationId: ORG_ID,
    OrganizationName: "SampleOrg",
    OutputParameters: [],
    OwningExtension: { Id: STEP_ID, KeyAttributes: [], LogicalName: "sdkmessageprocessingstep", Name: null, RowVersion: null },
    ParentContext: null,
    PostEntityImages: [],
    PreEntityImages: [],
    PrimaryEntityId: PRIMARY_ID,
    PrimaryEntityName: opts.primaryEntityName,
    RequestId: null,
    SecondaryEntityName: "none",
    SharedVariables: [],
    Stage: opts.stage ?? 40,
    UserId: USER_ID,
  };
}
