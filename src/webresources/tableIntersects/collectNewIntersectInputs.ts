import { DataverseFormRecord, getDataverseForms } from "../../general/dataverse/getDataverseForms";
import { MultiStepInput, shouldResume, validationIgnore } from "../../general/inputControls";
import { getDataverseTables } from "../../general/dataverse/getDataverseTables";
import { NewIntersectState } from "./tableIntersects";

export async function collectNewIntersectInputs(state: NewIntersectState): Promise<NewIntersectState> {
  state.tables = (await getDataverseTables(state.context)).map((table) => {
    return { label: table };
  });
  if (state.tables.length < 1) {
    state.context.channel.appendLine("No tables found in dataverse");
    state.error = true;
    return state;
  }
  await MultiStepInput.run((input) => inputEntity(input, state));
  return state as NewIntersectState;

  async function inputEntity(input: MultiStepInput, state: NewIntersectState) {
    state.entity = (
      (await input.showQuickPick({
        title: "Create Form Intersect",
        step: 1,
        totalSteps: 4,
        placeholder: "Select Table",
        items: state.tables,
        shouldResume: shouldResume,
      })) as { label: string }
    ).label;
    if (state.entity === undefined) {
      state.context.channel.appendLine("No table specified.");
      state.error = true;
      return;
    }
    state.formsQuestions = (await getDataverseForms(state.context, state.entity)).map((form) => {
      return { label: form.displayName + " [" + form.formType + "]", target: form };
    });
    if (state.formsQuestions.length < 1) {
      state.context.channel.appendLine("No forms found for table " + state.entity);
      state.error = true;
      return;
    }
    return (input: MultiStepInput) => inputFormId(input, state, 0);
  }

  async function inputFormId(input: MultiStepInput, state: NewIntersectState, i: number): Promise<any> {
    state.forms[i] = (
      (await input.showQuickPick({
        title: "Create Form Registration",
        step: i + 2,
        totalSteps: 4,
        placeholder: "Select Form " + (i + 1).toString(),
        items: state.formsQuestions,
        shouldResume: shouldResume,
      })) as { label: string; target: DataverseFormRecord }
    ).target;
    if (i < 1) {
      return (input: MultiStepInput) => inputFormId(input, state, i + 1);
    }
    return (input: MultiStepInput) => inputIntersectName(input, state);
  }

  async function inputIntersectName(input: MultiStepInput, state: NewIntersectState): Promise<any> {
    state.intersectName = await input.showInputBox({
      ignoreFocusOut: true,
      title: "Create Form Registration",
      step: 4,
      totalSteps: 4,
      value: state.intersectName || "",
      prompt: "What is the intersect name?",
      validate: validationIgnore,
      shouldResume: shouldResume,
    });
    if (state.intersectName === undefined) {
      state.context.channel.appendLine("No intersect name specified.");
      state.error = true;
      return;
    }
    return;
  }
}
