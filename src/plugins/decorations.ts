/* eslint-disable @typescript-eslint/naming-convention */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import DataversePowerToolsContext from "../context";
import { MultiStepInput, shouldResume, validationIgnore } from "../general/inputControls";
import { getDataverseTables } from "../general/dataverse/getDataverseTables";
import { getDataverseTableAttributes } from "../general/dataverse/getDataverseTableAttributes";
import { ExecutionModeEnum, IsolationModeEnum, MessageNameEnum, PluginState, StageEnum, WorkflowState } from "../typings/decorations";

function getEol(document: vscode.TextDocument): string {
  return document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findClassLineForBaseTypes(document: vscode.TextDocument, baseTypes: string[]): { line: number; indent: string } | undefined {
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
    const lineText = document.lineAt(lineIndex).text;
    const classMatch = lineText.match(/^(\s*)public\s+class\s+\w+\s*:\s*([^\{]+)$/);
    if (!classMatch) {
      continue;
    }

    const inheritanceClause = classMatch[2] || "";
    const matchesBaseType = baseTypes.some((baseType) => new RegExp(`\\b${escapeRegex(baseType)}\\b`).test(inheritanceClause));
    if (!matchesBaseType) {
      continue;
    }

    return { line: lineIndex, indent: classMatch[1] ?? "" };
  }

  return undefined;
}

function findDecorationInsertionLine(document: vscode.TextDocument, classLine: number): number {
  let insertionLine = classLine;

  for (let lineIndex = classLine - 1; lineIndex >= 0; lineIndex--) {
    const lineText = document.lineAt(lineIndex).text.trim();
    if (lineText.length === 0) {
      continue;
    }

    if (lineText.startsWith("[")) {
      insertionLine = lineIndex;
      continue;
    }

    break;
  }

  return insertionLine;
}

async function ensureCrmPluginRegistrationSupport(context: DataversePowerToolsContext): Promise<void> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return;
  }

  const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const registrationAttributePath = path.join(workspacePath, "CrmPluginRegistrationAttribute.generated.cs");
  if (fs.existsSync(registrationAttributePath)) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    "CrmPluginRegistrationAttribute helper is missing. Create it now so decoration attributes compile and can be processed for step registration?",
    "Create",
    "Skip",
  );

  if (choice !== "Create") {
    return;
  }

  const templatePath = context.vscode.asAbsolutePath(path.join("templates", "plugin", "CrmPluginRegistrationAttribute.generated.cs", "1.cs"));
  const templateContents = await fs.promises.readFile(templatePath, "utf8");
  await vscode.workspace.fs.writeFile(vscode.Uri.file(registrationAttributePath), Buffer.from(templateContents, "utf8"));
  context.channel.appendLine("Created CrmPluginRegistrationAttribute.generated.cs for plugin/workflow decorations.");
}

async function insertDecorationAboveClass(
  context: DataversePowerToolsContext,
  editor: vscode.TextEditor,
  decorationText: string,
  baseTypes: string[],
  notValidMessage: string,
): Promise<void> {
  const document = editor.document;

  if (document.languageId !== "csharp" || !document.fileName.toLowerCase().endsWith(".cs")) {
    vscode.window.showWarningMessage(notValidMessage);
    return;
  }

  const classTarget = findClassLineForBaseTypes(document, baseTypes);
  if (!classTarget) {
    vscode.window.showWarningMessage(notValidMessage);
    return;
  }

  await ensureCrmPluginRegistrationSupport(context);

  const eol = getEol(document);
  const insertion = `${classTarget.indent}${decorationText}${eol}`;
  const insertionLine = findDecorationInsertionLine(document, classTarget.line);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, new vscode.Position(insertionLine, 0), insertion);
  await vscode.workspace.applyEdit(edit);
}

export async function addPluginDecoration(_context: DataversePowerToolsContext): Promise<void> {
  const outputs = await collectPluginInputs(_context);
  const decoration = `[CrmPluginRegistration(MessageNameEnum.${outputs.messageName}, "${outputs.entityName}", StageEnum.${outputs.stage}, ExecutionModeEnum.${outputs.executionMode}, "${outputs.filteringAttributes}", "${outputs.stepName}", ${outputs.executionOrder}, IsolationModeEnum.${outputs.isolationMode}, Id = "${outputs.id}")]`;
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open a plugin class file to add plugin decoration.");
    return;
  }

  await insertDecorationAboveClass(_context, editor, decoration, ["PluginBase"], "Plugin decoration only works in a plugin class file that inherits PluginBase.");
}

export async function addWorkflowDecoration(_context: DataversePowerToolsContext): Promise<void> {
  const outputs = await collectWorkflowInputs();
  const decoration = `[CrmPluginRegistration("WorkflowActivity", "${outputs.workflowName}", "${outputs.workflowDescription}", "${outputs.workflowGroup}", IsolationModeEnum.${outputs.isolationMode})]`;
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open a workflow class file to add workflow decoration.");
    return;
  }

  await insertDecorationAboveClass(
    _context,
    editor,
    decoration,
    ["WorkflowBase", "CodeActivity"],
    "Workflow decoration only works in a workflow class file that inherits WorkflowBase or CodeActivity.",
  );
}

function detectDecorationTarget(editor: vscode.TextEditor): "plugin" | "workflow" | undefined {
  const document = editor.document;
  const pluginClassLine = findClassLineForBaseTypes(document, ["PluginBase"])?.line;
  const workflowClassLine = findClassLineForBaseTypes(document, ["WorkflowBase", "CodeActivity"])?.line;

  if (pluginClassLine === undefined && workflowClassLine === undefined) {
    return undefined;
  }

  if (pluginClassLine !== undefined && workflowClassLine === undefined) {
    return "plugin";
  }

  if (pluginClassLine === undefined && workflowClassLine !== undefined) {
    return "workflow";
  }

  const cursorLine = editor.selection.active.line;
  const pluginDistance = Math.abs((pluginClassLine as number) - cursorLine);
  const workflowDistance = Math.abs((workflowClassLine as number) - cursorLine);
  return pluginDistance <= workflowDistance ? "plugin" : "workflow";
}

export async function addClassDecoration(context: DataversePowerToolsContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open a plugin or workflow class file to add class decoration.");
    return;
  }

  if (editor.document.languageId !== "csharp" || !editor.document.fileName.toLowerCase().endsWith(".cs")) {
    vscode.window.showWarningMessage("Open a C# plugin or workflow class file to add class decoration.");
    return;
  }

  const decorationTarget = detectDecorationTarget(editor);
  if (decorationTarget === "plugin") {
    await addPluginDecoration(context);
    return;
  }

  if (decorationTarget === "workflow") {
    await addWorkflowDecoration(context);
    return;
  }

  vscode.window.showWarningMessage("Could not detect plugin or workflow class. Ensure the class inherits PluginBase, WorkflowBase, or CodeActivity.");
}

interface DecorationArgsParseResult {
  arguments: string[];
  argumentRanges: Array<{ start: number; end: number }>;
}

function parseDecorationArguments(argumentsText: string): DecorationArgsParseResult {
  const argumentsList: string[] = [];
  const argumentRanges: Array<{ start: number; end: number }> = [];
  let inString = false;
  let isEscaped = false;
  let parenthesisDepth = 0;
  let argumentStart = 0;

  for (let index = 0; index < argumentsText.length; index++) {
    const char = argumentsText[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char === "\\") {
        isEscaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "(") {
      parenthesisDepth++;
      continue;
    }

    if (char === ")") {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
      continue;
    }

    if (char === "," && parenthesisDepth === 0) {
      const rawArgument = argumentsText.slice(argumentStart, index);
      argumentsList.push(rawArgument.trim());
      argumentRanges.push({ start: argumentStart, end: index });
      argumentStart = index + 1;
    }
  }

  const finalArgument = argumentsText.slice(argumentStart);
  argumentsList.push(finalArgument.trim());
  argumentRanges.push({ start: argumentStart, end: argumentsText.length });

  return { arguments: argumentsList, argumentRanges };
}

function getQuotedValue(argumentText: string): string | undefined {
  const trimmed = argumentText.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function escapeForQuotedArgument(value: string): string {
  return JSON.stringify(value);
}

function findDecorationBoundsAtCursor(document: vscode.TextDocument, cursorOffset: number): { start: number; end: number } | undefined {
  const fullText = document.getText();
  const token = "[CrmPluginRegistration(";
  let searchIndex = fullText.indexOf(token);

  while (searchIndex >= 0) {
    const endIndex = fullText.indexOf("]", searchIndex);
    if (endIndex < 0) {
      break;
    }

    if (cursorOffset >= searchIndex && cursorOffset <= endIndex + 1) {
      return { start: searchIndex, end: endIndex + 1 };
    }

    searchIndex = fullText.indexOf(token, endIndex + 1);
  }

  return undefined;
}

function findDecorationBoundsAtLine(document: vscode.TextDocument, targetLine: number): { start: number; end: number } | undefined {
  const fullText = document.getText();
  const decorationRegex = /\[CrmPluginRegistration\(([\s\S]*?)\)\]/g;
  let match = decorationRegex.exec(fullText);

  while (match) {
    const startOffset = match.index;
    const endOffset = match.index + match[0].length;
    const startLine = document.positionAt(startOffset).line;
    if (startLine === targetLine) {
      return { start: startOffset, end: endOffset };
    }

    match = decorationRegex.exec(fullText);
  }

  return undefined;
}

export async function updateFilteringAttributes(context: DataversePowerToolsContext, targetLine?: number): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open a C# file and place the cursor on a CrmPluginRegistration decoration.");
    return;
  }

  const document = editor.document;
  if (document.languageId !== "csharp" || !document.fileName.toLowerCase().endsWith(".cs")) {
    vscode.window.showWarningMessage("Update Filtering Attributes is only available for C# files.");
    return;
  }

  const cursorOffset = document.offsetAt(editor.selection.active);
  const decorationBounds = typeof targetLine === "number" ? findDecorationBoundsAtLine(document, targetLine) : findDecorationBoundsAtCursor(document, cursorOffset);
  if (!decorationBounds) {
    vscode.window.showWarningMessage("Place the cursor directly on a CrmPluginRegistration decoration to update filtering attributes.");
    return;
  }

  const decorationText = document.getText(new vscode.Range(document.positionAt(decorationBounds.start), document.positionAt(decorationBounds.end)));
  const openParenIndex = decorationText.indexOf("(");
  const closeParenIndex = decorationText.lastIndexOf(")");
  if (openParenIndex < 0 || closeParenIndex < 0 || closeParenIndex <= openParenIndex) {
    vscode.window.showWarningMessage("Could not parse the selected CrmPluginRegistration decoration.");
    return;
  }

  const argumentsText = decorationText.slice(openParenIndex + 1, closeParenIndex);
  const parsed = parseDecorationArguments(argumentsText);
  if (parsed.arguments.length < 8 || !parsed.arguments[2].includes("StageEnum.")) {
    vscode.window.showWarningMessage("Selected decoration is not a plugin step registration with filtering attributes.");
    return;
  }

  const entityLogicalName = getQuotedValue(parsed.arguments[1]);
  if (!entityLogicalName) {
    vscode.window.showWarningMessage("Could not determine entity logical name from the selected decoration.");
    return;
  }

  const existingFilteringAttributes = getQuotedValue(parsed.arguments[4]) || "";
  const selectedFilteringAttributes = await pickFilteringAttributesFromDataverse(context, entityLogicalName, existingFilteringAttributes);
  if (selectedFilteringAttributes === undefined) {
    return;
  }

  const filteringArgumentRange = parsed.argumentRanges[4];
  const replacementText = escapeForQuotedArgument(selectedFilteringAttributes);
  const replacementStart = decorationBounds.start + openParenIndex + 1 + filteringArgumentRange.start;
  const replacementEnd = decorationBounds.start + openParenIndex + 1 + filteringArgumentRange.end;

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(replacementStart), document.positionAt(replacementEnd)), replacementText);
  await vscode.workspace.applyEdit(edit);
  context.channel.appendLine(`Updated filtering attributes for entity ${entityLogicalName}.`);
}

async function collectPluginInputs(context: DataversePowerToolsContext): Promise<PluginState> {
  const state = {} as Partial<PluginState>;
  state.id = uuidv4();
  await MultiStepInput.run((input) => inputMessageName(input, state, context));
  return state as PluginState;
}

async function collectWorkflowInputs(): Promise<WorkflowState> {
  const state = {} as Partial<WorkflowState>;
  await MultiStepInput.run((input) => inputWorkflowName(input, state));
  return state as WorkflowState;
}

async function inputMessageName(input: MultiStepInput, state: Partial<PluginState>, context: DataversePowerToolsContext) {
  const items = Object.keys(MessageNameEnum)
    .filter((entry) => isNaN(Number(entry)))
    .map((key) => ({ label: key, target: key }));

  state.messageName = (
    await input.showQuickPick({
      title: "Create Plugin Step",
      step: 1,
      totalSteps: 8,
      placeholder: "Select Plugin Step Message",
      items,
      shouldResume,
    })
  ).label;
  return (nextInput: MultiStepInput) => inputEntityName(nextInput, state, context);
}

async function inputEntityName(input: MultiStepInput, state: Partial<PluginState>, context: DataversePowerToolsContext) {
  const entityFromDataverse = await pickEntityFromDataverse(context);
  if (entityFromDataverse) {
    state.entityName = entityFromDataverse;
  } else {
    state.entityName = await input.showInputBox({
      ignoreFocusOut: true,
      title: "Create Plugin Step",
      step: 2,
      totalSteps: 8,
      value: state.entityName || "",
      prompt: "What is the table name",
      validate: validationIgnore,
      shouldResume,
    });
  }

  return (nextInput: MultiStepInput) => inputStage(nextInput, state, context);
}

async function inputStage(input: MultiStepInput, state: Partial<PluginState>, context: DataversePowerToolsContext) {
  const items = Object.keys(StageEnum)
    .filter((entry) => isNaN(Number(entry)))
    .map((key) => ({ label: key, target: key }));

  state.stage = (
    await input.showQuickPick({
      title: "Create Plugin Step",
      step: 3,
      totalSteps: 8,
      placeholder: "Select Stage",
      items,
      shouldResume,
    })
  ).label;
  return (nextInput: MultiStepInput) => inputExecutionMode(nextInput, state, context);
}

async function inputExecutionMode(input: MultiStepInput, state: Partial<PluginState>, context: DataversePowerToolsContext) {
  const items = Object.keys(ExecutionModeEnum)
    .filter((entry) => isNaN(Number(entry)))
    .map((key) => ({ label: key, target: key }));

  state.executionMode = (
    await input.showQuickPick({
      title: "Create Plugin Step",
      step: 4,
      totalSteps: 8,
      placeholder: "Select Execution Mode",
      items,
      shouldResume,
    })
  ).label;
  return (nextInput: MultiStepInput) => inputFilteringAttributes(nextInput, state, context);
}

async function inputFilteringAttributes(input: MultiStepInput, state: Partial<PluginState>, context: DataversePowerToolsContext) {
  const entityName = state.entityName || "";
  const filteringAttributesFromDataverse = entityName ? await pickFilteringAttributesFromDataverse(context, entityName) : undefined;

  if (filteringAttributesFromDataverse !== undefined) {
    state.filteringAttributes = filteringAttributesFromDataverse;
  } else {
    state.filteringAttributes = await input.showInputBox({
      ignoreFocusOut: true,
      title: "Create Plugin Step",
      step: 5,
      totalSteps: 8,
      value: state.filteringAttributes || "",
      prompt: "What is the filtering attributes (comma seperated, hit enter for none)",
      validate: validationIgnore,
      shouldResume,
    });
  }

  return (nextInput: MultiStepInput) => inputStepName(nextInput, state, context);
}

async function inputStepName(input: MultiStepInput, state: Partial<PluginState>, context: DataversePowerToolsContext) {
  state.stepName = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Plugin Step",
    step: 6,
    totalSteps: 8,
    value: state.stepName || "",
    prompt: "What is the step display name",
    validate: validationIgnore,
    shouldResume,
  });
  return (nextInput: MultiStepInput) => inputExecutionOrder(nextInput, state, context);
}

async function inputExecutionOrder(input: MultiStepInput, state: Partial<PluginState>, context: DataversePowerToolsContext) {
  state.executionOrder = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Plugin Step",
    step: 7,
    totalSteps: 8,
    value: state.executionOrder?.toString() || "0",
    prompt: "What is the execution order (Number)",
    validate: validationIgnore,
    shouldResume,
  });
  return (nextInput: MultiStepInput) => inputPluginIsolationMode(nextInput, state, context);
}

async function inputPluginIsolationMode(input: MultiStepInput, state: Partial<PluginState>, _context: DataversePowerToolsContext) {
  const items = Object.keys(IsolationModeEnum)
    .filter((entry) => isNaN(Number(entry)))
    .map((key) => ({ label: key, target: key }));

  state.isolationMode = (
    await input.showQuickPick({
      title: "Create Plugin Step",
      step: 8,
      totalSteps: 8,
      placeholder: "Select Isolation Mode (Sandbox for Online)",
      items,
      shouldResume,
    })
  ).label;
  return;
}
async function pickEntityFromDataverse(context: DataversePowerToolsContext): Promise<string | undefined> {
  const tables = await getDataverseTables(context);
  if (tables.length === 0) {
    return undefined;
  }

  const pickedEntity = await vscode.window.showQuickPick(
    tables.map((table) => ({ label: table })),
    {
      ignoreFocusOut: true,
      placeHolder: "Select Dataverse table logical name",
      title: "Create Plugin Step",
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );

  return pickedEntity?.label;
}

async function pickFilteringAttributesFromDataverse(context: DataversePowerToolsContext, entityLogicalName: string, preselectedCsv?: string): Promise<string | undefined> {
  const attributes = await getDataverseTableAttributes(context, entityLogicalName);
  if (attributes.length === 0) {
    return undefined;
  }

  const preselectedAttributes = new Set(
    (preselectedCsv || "")
      .split(",")
      .map((attribute) => attribute.trim())
      .filter((attribute) => attribute.length > 0),
  );

  const selectedAttributes = await vscode.window.showQuickPick(
    attributes.map((attribute) => ({ label: attribute, picked: preselectedAttributes.has(attribute) })),
    {
      canPickMany: true,
      ignoreFocusOut: true,
      placeHolder: "Select filtering attributes (leave empty for none)",
      title: "Create Plugin Step",
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );

  if (!selectedAttributes) {
    return "";
  }

  return selectedAttributes.map((attribute) => attribute.label).join(",");
}

async function inputWorkflowName(input: MultiStepInput, state: Partial<WorkflowState>) {
  state.workflowName = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Workflow Decoration",
    step: 1,
    totalSteps: 4,
    value: state.workflowName || "",
    prompt: "What is the workflow name",
    validate: validationIgnore,
    shouldResume,
  });
  return (nextInput: MultiStepInput) => inputWorkflowDescription(nextInput, state);
}

async function inputWorkflowDescription(input: MultiStepInput, state: Partial<WorkflowState>) {
  state.workflowDescription = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Workflow Decoration",
    step: 2,
    totalSteps: 4,
    value: state.workflowDescription || "",
    prompt: "What is the description",
    validate: validationIgnore,
    shouldResume,
  });
  return (nextInput: MultiStepInput) => inputWorkflowGroup(nextInput, state);
}

async function inputWorkflowGroup(input: MultiStepInput, state: Partial<WorkflowState>) {
  state.workflowGroup = await input.showInputBox({
    ignoreFocusOut: true,
    title: "Create Workflow Decoration",
    step: 3,
    totalSteps: 4,
    value: state.workflowGroup || "",
    prompt: "What is the group name",
    validate: validationIgnore,
    shouldResume,
  });
  return (nextInput: MultiStepInput) => inputWorkflowIsolationMode(nextInput, state);
}

async function inputWorkflowIsolationMode(input: MultiStepInput, state: Partial<WorkflowState>) {
  const items = Object.keys(IsolationModeEnum)
    .filter((entry) => isNaN(Number(entry)))
    .map((key) => ({ label: key, target: key }));

  state.isolationMode = (
    await input.showQuickPick({
      title: "Create Workflow Decoration",
      step: 4,
      totalSteps: 4,
      placeholder: "Select Isolation Mode (Sandbox for Online)",
      items,
      shouldResume,
    })
  ).label;
  return;
}
