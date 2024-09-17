import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import DataversePowerToolsContext, { TemplatePlaceholder } from "../context";
import { MultiStepInput, shouldResume, validationIgnore } from "../general/inputControls";
import { getDataverseForms } from "../general/dataverse/getDataverseForms";
import { getDataverseTables } from "../general/dataverse/getDataverseTables";
import { createTemplatedFile } from "../general/generateTemplates";
import path = require("path");

export async function createWebResourceClass(context: DataversePowerToolsContext) {
  if (!vscode.workspace.workspaceFolders) {
    return;
  }
  
  const outputs = await collectInputs(context);
  
  const placeholders = [
    { placeholder: "TableName", value: outputs.entity ?? "" },
    { placeholder: "FormName", value: outputs.formName ?? "" },
    { placeholder: "ClassName", value: outputs.className ?? "" },
    { placeholder: "FORMIDPLACEHOLDER", value: outputs.formId ?? "" },
    { placeholder: "NEWGUID", value: uuidv4() },
  ] as TemplatePlaceholder[];
  await createTemplatedFile(context, "class", outputs.className ?? "", placeholders);
  var library = (await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, "webresources_src", "library.ts")))).toString();
  library = library.trim() + ('\nexport * from "./' + outputs.className + '";\n');
  await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, "webresources_src", "library.ts")), Buffer.from(library, "utf8"));
  
  const testsPlaceholders = [
    { placeholder: "ClassName", value: outputs.className ?? "" },
  ] as TemplatePlaceholder[];
  await createTemplatedFile(context, "sample.test", (outputs.className ?? "") + ".test", testsPlaceholders);

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
    title: "Create Webresource Class",
    step: 1,
    totalSteps: 4,
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
          title: "Create Webresource Class",
          step: 2,
          totalSteps: 4,
          placeholder: "Select Table",
          items: tables,
          shouldResume: shouldResume,
        })) as any
      ).label;
      return (input: MultiStepInput) => inputFormId(input, state);
    }
  }
  state.entity = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Webresource Class",
    step: 3,
    totalSteps: 4,
    value: state.className || "",
    prompt: "What is table name?",
    validate: validationIgnore,
    shouldResume: shouldResume,
  });
  return (input: MultiStepInput) => inputFormId(input, state);
}

async function inputFormId(input: MultiStepInput, state: Partial<State>) {
  if (state.context && state.entity) {
    const forms = (await getDataverseForms(state.context, state.entity)).map((form) => {
      return { label: form.displayName + " [" + form.formType + "]", target: form.formId, name: form.displayName };
    });
    if (forms.length > 0) {
      const selectedForm = await input.showQuickPick({
        title: "Create Webresource Class",
        step: 3,
        totalSteps: 4,
        placeholder: "Select Form",
        items: forms,
        shouldResume: shouldResume,
      }) as { label: string; target: string };
      state.formId = (selectedForm as any).target;
      state.formName = (selectedForm as any).name;
      return (input: MultiStepInput) => inputAddTest(input, state);
    }
  }
  state.formId = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Webresource Class",
    step: 3,
    totalSteps: 4,
    value: state.className || "",
    prompt: "What is form id",
    validate: validationIgnore,
    shouldResume: shouldResume,
  });
  return (input: MultiStepInput) => inputAddTest(input, state);
}

async function inputAddTest(input: MultiStepInput, state: Partial<State>) {
  state.addTest = (await input.showQuickPick({
    title: "Create Webresource Class",
    step: 4,
    totalSteps: 4,
    placeholder: "Create Test?",
    items: [
      { label: "Yes", target: true },
      { label: "No", target: false },
    ],
    shouldResume: shouldResume,
  }) as any).target;
  return;
}

interface State {
  context: DataversePowerToolsContext;
  formId: string;
  formName: string;
  addTest: boolean;
  eventType: "onload" | "onsave";
  sendExecutionContext: boolean;
  functionName: string;
  className: string;
  id: string;
  entity: string;
}

export async function createWebResourceTest(context: DataversePowerToolsContext) {
  if (!vscode.workspace.workspaceFolders) {
    return;
  }
  const name = await vscode.window.showInputBox({ prompt: "Enter in the name of the class to test" });
  const placeholders = [
    { placeholder: "ClassName", value: name ?? "" },
  ] as TemplatePlaceholder[];
  await createTemplatedFile(context, "sample.test", (name ?? "") + ".test", placeholders);
}
