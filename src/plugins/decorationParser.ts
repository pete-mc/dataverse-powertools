// Pure parsing of the [CrmPluginRegistration(...)] attributes in a C# source file into the plugin
// steps and workflow activities Build & Deploy registers. Kept `vscode`-free so it is unit-testable.
import { PluginStepRegistration, WorkflowActivityRegistration } from "../general/dataverse/stepPayloads";

export interface ParsedDecorationResult {
  pluginSteps: PluginStepRegistration[];
  workflowActivities: WorkflowActivityRegistration[];
}

function splitTopLevelArguments(argumentsText: string): string[] {
  const argumentsList: string[] = [];
  let current = "";
  let inString = false;
  let isEscaped = false;
  let parenDepth = 0;

  for (let index = 0; index < argumentsText.length; index++) {
    const char = argumentsText[index];

    if (inString) {
      current += char;
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
      current += char;
      continue;
    }

    if (char === "(") {
      parenDepth++;
      current += char;
      continue;
    }

    if (char === ")") {
      parenDepth = Math.max(parenDepth - 1, 0);
      current += char;
      continue;
    }

    if (char === "," && parenDepth === 0) {
      argumentsList.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    argumentsList.push(current.trim());
  }

  return argumentsList;
}

function getQuotedStringValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.substring(1, trimmed.length - 1).replace(/\\"/g, '"');
  }

  return trimmed;
}

function parseStage(stageValue: string): number {
  const stageName = stageValue.trim().replace("StageEnum.", "");
  if (stageName === "PreValidation") {
    return 10;
  }
  if (stageName === "PreOperation") {
    return 20;
  }
  return 40;
}

function parseMode(modeValue: string): number {
  const modeName = modeValue.trim().replace("ExecutionModeEnum.", "");
  return modeName === "Asynchronous" ? 1 : 0;
}

function parseStepId(argumentsList: string[]): string | undefined {
  const idArgument = argumentsList.find((argument) => argument.startsWith("Id"));
  if (!idArgument) {
    return undefined;
  }

  const idMatch = idArgument.match(/Id\s*=\s*"([0-9a-fA-F-]{36})"/);
  return idMatch?.[1];
}

function extractNamespace(content: string): string {
  const namespaceMatch = content.match(/namespace\s+([A-Za-z0-9_.]+)/);
  return namespaceMatch?.[1] || "Plugin";
}

export function parseDecorationsFromContent(content: string): ParsedDecorationResult {
  const namespaceName = extractNamespace(content);
  const pluginSteps: PluginStepRegistration[] = [];
  const workflowActivities: WorkflowActivityRegistration[] = [];

  // Each attribute is its own match; the owning class is found by LOOKAHEAD so it isn't consumed —
  // otherwise a second stacked [CrmPluginRegistration] on the same class is swallowed by the first
  // match and silently never registered (#295).
  const regex = /\[CrmPluginRegistration\(([\s\S]*?)\)\](?=[\s\S]*?public\s+class\s+(\w+)\s*:\s*([^\r\n\{]+))/g;
  let match = regex.exec(content);
  while (match) {
    const argsText = match[1];
    const className = match[2];
    const classInheritance = match[3] || "";
    const args = splitTopLevelArguments(argsText);

    const isWorkflow = argsText.includes('"WorkflowActivity"') || classInheritance.includes("WorkflowBase") || classInheritance.includes("CodeActivity");
    if (isWorkflow) {
      workflowActivities.push({
        className,
        fullTypeName: `${namespaceName}.${className}`,
        workflowName: getQuotedStringValue(args[1] || `"${className}"`),
        workflowDescription: getQuotedStringValue(args[2] || '""'),
        workflowGroup: getQuotedStringValue(args[3] || '""'),
      });
      match = regex.exec(content);
      continue;
    }

    const isPluginStep = args.length >= 8 && args[0].includes("MessageNameEnum.") && args[2].includes("StageEnum.");
    if (!isPluginStep) {
      match = regex.exec(content);
      continue;
    }

    const messageName = args[0].replace("MessageNameEnum.", "").trim();
    const entityLogicalName = getQuotedStringValue(args[1]);
    const stage = parseStage(args[2]);
    const mode = parseMode(args[3]);
    const filteringAttributes = getQuotedStringValue(args[4]);
    const stepName = getQuotedStringValue(args[5]);
    const executionOrder = Number(args[6]);
    const stepId = parseStepId(args);

    pluginSteps.push({
      className,
      fullTypeName: `${namespaceName}.${className}`,
      messageName,
      entityLogicalName,
      stage,
      mode,
      filteringAttributes,
      stepName,
      executionOrder: Number.isFinite(executionOrder) ? executionOrder : 1,
      stepId,
    });

    match = regex.exec(content);
  }

  return { pluginSteps, workflowActivities };
}
