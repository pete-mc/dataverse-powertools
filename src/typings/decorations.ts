/* eslint-disable @typescript-eslint/naming-convention */

export interface PluginState {
  messageName: string;
  entityName: string;
  stage: string;
  executionMode: string;
  filteringAttributes: string;
  stepName: string;
  executionOrder: string;
  isolationMode: string;
  id: string;
}

export interface WorkflowState {
  workflowName: string;
  workflowDescription: string;
  workflowGroup: string;
  isolationMode: string;
}

export enum MessageNameEnum {
  AddItem,
  AddListMembers,
  AddMember,
  AddMembers,
  AddPrincipalToQueue,
  AddPrivileges,
  AddProductToKit,
  AddRecurrence,
  AddToQueue,
  AddUserToRecordTeam,
  ApplyRecordCreationAndUpdateRule,
  Assign,
  Associate,
  BackgroundSend,
  Book,
  CalculatePrice,
  Cancel,
  CheckIncoming,
  CheckPromote,
  Clone,
  CloneMobileOfflineProfile,
  CloneProduct,
  Close,
  CopyDynamicListToStatic,
  CopySystemForm,
  Create,
  CreateException,
  CreateInstance,
  CreateKnowledgeArticleTranslation,
  CreateKnowledgeArticleVersion,
  Delete,
  DeleteOpenInstances,
  DeliverIncoming,
  DeliverPromote,
  Disassociate,
  Execute,
  ExecuteById,
  Export,
  GenerateSocialProfile,
  GetDefaultPriceLevel,
  GrantAccess,
  Import,
  LockInvoicePricing,
  LockSalesOrderPricing,
  Lose,
  Merge,
  ModifyAccess,
  PickFromQueue,
  Publish,
  PublishAll,
  PublishTheme,
  QualifyLead,
  Recalculate,
  ReleaseToQueue,
  RemoveFromQueue,
  RemoveItem,
  RemoveMember,
  RemoveMembers,
  RemovePrivilege,
  RemoveProductFromKit,
  RemoveRelated,
  RemoveUserFromRecordTeam,
  ReplacePrivileges,
  Reschedule,
  Retrieve,
  RetrieveExchangeRate,
  RetrieveFilteredForms,
  RetrieveMultiple,
  RetrievePersonalWall,
  RetrievePrincipalAccess,
  RetrieveRecordWall,
  RetrieveSharedPrincipalsAndAccess,
  RetrieveUnpublished,
  RetrieveUnpublishedMultiple,
  RetrieveUserQueues,
  RevokeAccess,
  RouteTo,
  Send,
  SendFromTemplate,
  SetLocLabels,
  SetRelated,
  SetState,
  TriggerServiceEndpointCheck,
  UnlockInvoicePricing,
  UnlockSalesOrderPricing,
  Update,
  ValidateRecurrenceRule,
  Win,
}

export enum StageEnum {
  PreValidation = 10,
  PreOperation = 20,
  PostOperation = 40,
}
export enum ExecutionModeEnum {
  Asynchronous,
  Synchronous,
}

export enum IsolationModeEnum {
  None = 0,
  Sandbox = 1,
}
