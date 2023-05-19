/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import DataversePowerToolsContext from "../context";
import { MultiStepInput, shouldResume, validationIgnore } from "../general/inputControls";

export async function addPluginDecoration(_context: DataversePowerToolsContext) {
  const outputs = await collectInputs();
  const decoration = `[CrmPluginRegistration(MessageNameEnum.${outputs.messageName}, "${outputs.entityName}", StageEnum.${outputs.stage}, ExecutionModeEnum.${outputs.executionMode}, "${outputs.filteringAttributes}", "${outputs.stepName}", ${outputs.executionOrder}, IsolationModeEnum.${outputs.isolationMode}, Id = "${outputs.id}")]`;
  vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(decoration));
}

async function collectInputs() {
  const state = {} as Partial<State>;
  state.id = uuidv4();
  await MultiStepInput.run((input) => inputMessageName(input, state));
  return state as State;
}

async function inputMessageName(input: MultiStepInput, state: Partial<State>) {
  const items = Object.keys(MessageNameEnum)
    .filter((e) => {
      return isNaN(Number(e));
    })
    .map((key) => {
      return { label: key, target: key };
    });
  state.messageName = (
    await input.showQuickPick({
      title: "Create Plugin Step",
      step: 1,
      totalSteps: 8,
      placeholder: "Select Plugin Step Message",
      items: items,
      shouldResume: shouldResume,
    })
  ).label;
  return (input: MultiStepInput) => inputEntityName(input, state);
}

async function inputEntityName(input: MultiStepInput, state: Partial<State>) {
  state.entityName = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Plugin Step",
    step: 2,
    totalSteps: 8,
    value: state.entityName || "",
    prompt: "What is the table name",
    validate: validationIgnore,
    shouldResume: shouldResume,
  });
  return (input: MultiStepInput) => inputStage(input, state);
}

async function inputStage(input: MultiStepInput, state: Partial<State>) {
  const items = Object.keys(StageEnum)
    .filter((e) => {
      return isNaN(Number(e));
    })
    .map((key) => {
      return { label: key, target: key };
    });
  state.stage = (
    await input.showQuickPick({
      title: "Create Plugin Step",
      step: 3,
      totalSteps: 8,
      placeholder: "Select Stage",
      items: items,
      shouldResume: shouldResume,
    })
  ).label;
  return (input: MultiStepInput) => inputExecutionMode(input, state);
}

async function inputExecutionMode(input: MultiStepInput, state: Partial<State>) {
  const items = Object.keys(ExecutionModeEnum)
    .filter((e) => {
      return isNaN(Number(e));
    })
    .map((key) => {
      return { label: key, target: key };
    });
  state.executionMode = (
    await input.showQuickPick({
      title: "Create Plugin Step",
      step: 4,
      totalSteps: 8,
      placeholder: "Select Execution Mode",
      items: items,
      shouldResume: shouldResume,
    })
  ).label;
  return (input: MultiStepInput) => inputFilteringAttributes(input, state);
}

async function inputFilteringAttributes(input: MultiStepInput, state: Partial<State>) {
  state.filteringAttributes = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Plugin Step",
    step: 5,
    totalSteps: 8,
    value: state.filteringAttributes || "",
    prompt: "What is the filtering attributes (comma seperated, hit enter for none)",
    validate: validationIgnore,
    shouldResume: shouldResume,
  });
  return (input: MultiStepInput) => inputStepName(input, state);
}

async function inputStepName(input: MultiStepInput, state: Partial<State>) {
  state.stepName = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Plugin Step",
    step: 6,
    totalSteps: 8,
    value: state.stepName || "",
    prompt: "What is the step display name",
    validate: validationIgnore,
    shouldResume: shouldResume,
  });
  return (input: MultiStepInput) => inputExecutionOrder(input, state);
}

async function inputExecutionOrder(input: MultiStepInput, state: Partial<State>) {
  state.executionOrder = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Plugin Step",
    step: 7,
    totalSteps: 8,
    value: state.executionOrder?.toString() || "0",
    prompt: "What is the execution order (Number)",
    validate: validationIgnore,
    shouldResume: shouldResume,
  });
  return (input: MultiStepInput) => inputIsolationMode(input, state);
}

async function inputIsolationMode(input: MultiStepInput, state: Partial<State>) {
  const items = Object.keys(IsolationModeEnum)
    .filter((e) => {
      return isNaN(Number(e));
    })
    .map((key) => {
      return { label: key, target: key };
    });
  state.isolationMode = (
    await input.showQuickPick({
      title: "Create Plugin Step",
      step: 4,
      totalSteps: 8,
      placeholder: "Select Isolation Mode (Sandbox for Online)",
      items: items,
      shouldResume: shouldResume,
    })
  ).label;
  return;
}

interface State {
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

enum MessageNameEnum {
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

enum StageEnum {
  PreValidation = 10,
  PreOperation = 20,
  PostOperation = 40,
}

enum ExecutionModeEnum {
  Asynchronous,
  Synchronous,
}

enum IsolationModeEnum {
  None = 0,
  Sandbox = 1,
}
