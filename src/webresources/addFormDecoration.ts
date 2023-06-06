/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import DataversePowerToolsContext from "../context";
import { MultiStepInput, shouldResume, validationIgnore } from "../general/inputControls";
import { getDataverseForms } from "../general/dataverse/getDataverseForms";
import { getDataverseTables } from "../general/dataverse/getDataverseTables";

export async function addFormDecoration(context: DataversePowerToolsContext) {
  const outputs = await collectInputs(context);
  const decoration = `
<PowerTools.RegisterEvent[]>[
  {
    formId: "${outputs.formId}",
    event: "${outputs.eventType}",
    executionContext: ${outputs.sendExecutionContext},
    triggerId: "${outputs.id}",
    function: "${context.projectSettings.prefix}.${outputs.className}.${outputs.functionName}",
  },
];
`;
  vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(decoration));
}

async function collectInputs(context: DataversePowerToolsContext) {
  const state = {} as Partial<State>;
  state.context = context;
  state.id = uuidv4();
  await MultiStepInput.run((input) => inputClassName(input, state));
  return state as State;
}

async function inputClassName(input: MultiStepInput, state: Partial<State>) {
  state.className = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Form Registration",
    step: 1,
    totalSteps: 5,
    value: state.className || "",
    prompt: "What is the class name",
    validate: validationIgnore,
    shouldResume: shouldResume,
  });
  return (input: MultiStepInput) => inputEntity(input, state);
}
async function inputEntity(input: MultiStepInput, state: Partial<State>) {
  if (state.context) {
    const tables = (await getDataverseTables(state.context)).map((table) => {
      return { label: table };
    });
    if (tables.length > 0) {
      state.entity = (
        (await input.showQuickPick({
          title: "Create Form Registration",
          step: 2,
          totalSteps: 5,
          placeholder: "Select Table",
          items: tables,
          shouldResume: shouldResume,
        })) as any
      ).label;
      return (input: MultiStepInput) => inputFormId(input, state);
    }
  }
  return (input: MultiStepInput) => inputFormId(input, state);
}

async function inputFormId(input: MultiStepInput, state: Partial<State>) {
  if (state.context && state.entity) {
    const forms = (await getDataverseForms(state.context, state.entity)).map((form) => {
      return { label: form.displayName + " [" + form.formType + "]", target: form.formId };
    });
    if (forms.length > 0) {
      state.formId = (
        (await input.showQuickPick({
          title: "Create Form Registration",
          step: 2,
          totalSteps: 5,
          placeholder: "Select Form",
          items: forms,
          shouldResume: shouldResume,
        })) as any
      ).target;
      return (input: MultiStepInput) => inputEvent(input, state);
    }
  }
  state.formId = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Form Registration",
    step: 2,
    totalSteps: 5,
    value: state.className || "",
    prompt: "What is form id",
    validate: validationIgnore,
    shouldResume: shouldResume,
  });
  return (input: MultiStepInput) => inputEvent(input, state);
}

async function inputEvent(input: MultiStepInput, state: Partial<State>) {
  state.eventType = ((
    await input.showQuickPick({
      title: "Create Form Registration",
      step: 3,
      totalSteps: 5,
      placeholder: "Select Event",
      items: [{ label: "onsave" }, { label: "onload" }],
      shouldResume: shouldResume,
    })
  ).label || "onload") as "onsave" | "onload";
  return (input: MultiStepInput) => inputFunctionName(input, state);
}

async function inputFunctionName(input: MultiStepInput, state: Partial<State>) {
  state.functionName = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Form Registration",
    step: 4,
    totalSteps: 5,
    value: state.functionName || "",
    prompt: "What is the name of the function to call",
    validate: validationIgnore,
    shouldResume: shouldResume,
  });
  return (input: MultiStepInput) => inputExecutionContext(input, state);
}

async function inputExecutionContext(input: MultiStepInput, state: Partial<State>) {
  state.sendExecutionContext =
    (
      await input.showQuickPick({
        title: "Create Form Registration",
        step: 5,
        totalSteps: 5,
        placeholder: "Send ExecutionContext as first parameter?",
        items: [{ label: "Yes" }, { label: "No" }],
        shouldResume: shouldResume,
      })
    ).label === "No"
      ? false
      : true;
  return;
}

interface State {
  context: DataversePowerToolsContext;
  formId: string;
  eventType: "onload" | "onsave";
  sendExecutionContext: boolean;
  functionName: string;
  className: string;
  id: string;
  entity: string;
}
