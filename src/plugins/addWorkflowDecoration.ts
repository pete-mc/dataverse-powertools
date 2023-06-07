/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { MultiStepInput, shouldResume, validationIgnore } from "../general/inputControls";

export async function addWorkflowDecoration(_context: DataversePowerToolsContext) {
  const outputs = await collectInputs();
  const decoration = `[CrmPluginRegistration("WorkflowActivity","${outputs.workflowName}", "${outputs.workflowDescription}", "${outputs.workflowGroup}", IsolationModeEnum.${outputs.isolationMode})]`;
  vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(decoration));
}

async function collectInputs() {
  const state = {} as Partial<State>;
  await MultiStepInput.run((input) => inputWorkflowName(input, state));
  return state as State;
}

async function inputWorkflowName(input: MultiStepInput, state: Partial<State>) {
  state.workflowName = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Workflow Decoration",
    step: 1,
    totalSteps: 4,
    value: state.workflowName || "",
    prompt: "What is the workflow name",
    validate: validationIgnore,
    shouldResume: shouldResume,
  });
  return (input: MultiStepInput) => inputFilteringAttributes(input, state);
}

async function inputFilteringAttributes(input: MultiStepInput, state: Partial<State>) {
  state.workflowDescription = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Workflow Decoration",
    step: 2,
    totalSteps: 4,
    value: state.workflowDescription || "",
    prompt: "What is the description",
    validate: validationIgnore,
    shouldResume: shouldResume,
  });
  return (input: MultiStepInput) => inputStepName(input, state);
}

async function inputStepName(input: MultiStepInput, state: Partial<State>) {
  state.workflowGroup = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Workflow Decoration",
    step: 3,
    totalSteps: 4,
    value: state.workflowGroup || "",
    prompt: "Waht is the group name",
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
  workflowName: string;
  workflowDescription: string;
  workflowGroup: string;
  isolationMode: string;
}

enum IsolationModeEnum {
  None = 0,
  Sandbox = 1,
}
