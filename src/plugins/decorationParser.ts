// Pure parsing of the [CrmPluginRegistration(...)] attributes in a C# source file into the plugin
// steps and workflow activities Build & Deploy registers. Kept `vscode`-free so it is unit-testable.
import { PluginStepRegistration, WorkflowActivityRegistration } from "../general/dataverse/stepPayloads";

export interface ParsedDecorationResult {
  pluginSteps: PluginStepRegistration[];
  workflowActivities: WorkflowActivityRegistration[];
  /** Attributes found but not registered, with why — so Build & Deploy can say so instead of dropping them silently. */
  unrecognised: UnrecognisedDecoration[];
}

export interface UnrecognisedDecoration {
  attribute: string;
  reason: string;
}

/**
 * C# source with its comments blanked out, so a commented-out `// [CrmPluginRegistration(...)]` is not
 * registered. String and char literals (regular, verbatim `@"..."` and interpolated) are kept intact,
 * so a `//` inside a step name survives. Pure.
 */
export function stripCSharpComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index++;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      out += " ";
      continue;
    }
    if (char === '"' || char === "'") {
      const verbatim = source[index - 1] === "@" || (source[index - 1] === "$" && source[index - 2] === "@");
      let end = index + 1;
      while (end < source.length) {
        if (verbatim && source[end] === '"' && source[end + 1] === '"') {
          end += 2;
          continue;
        }
        if (!verbatim && source[end] === "\\") {
          end += 2;
          continue;
        }
        if (source[end] === char || (!verbatim && source[end] === "\n")) {
          break;
        }
        end++;
      }
      out += source.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    out += char;
    index++;
  }
  return out;
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

/** A plug-in or workflow class declaration, as the attributes above it must be followed by. Modifiers
 * a registrable class can carry (`sealed`, `partial`) are allowed in any order. */
const CLASS_DECLARATION = /^[\s\S]*?public\s+(?:(?:sealed|partial)\s+)*class\s+(\w+)\s*:\s*([^\r\n{]+)/;

export function parseDecorationsFromContent(source: string): ParsedDecorationResult {
  const content = stripCSharpComments(source);
  const namespaceName = extractNamespace(content);
  const pluginSteps: PluginStepRegistration[] = [];
  const workflowActivities: WorkflowActivityRegistration[] = [];
  const unrecognised: UnrecognisedDecoration[] = [];

  // Each attribute is matched on its own and its owning class found AFTER it without consuming
  // anything — otherwise a second stacked [CrmPluginRegistration] on the same class is swallowed by
  // the first and silently never registered (#295).
  const regex = /\[CrmPluginRegistration\(([\s\S]*?)\)\]/g;
  for (let match = regex.exec(content); match; match = regex.exec(content)) {
    const argsText = match[1];
    const owner = CLASS_DECLARATION.exec(content.slice(match.index + match[0].length));
    if (!owner) {
      unrecognised.push({ attribute: match[0], reason: "no public class declaration follows it" });
      continue;
    }
    const className = owner[1];
    const classInheritance = owner[2] || "";
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
      continue;
    }

    const isPluginStep = args.length >= 8 && args[0].includes("MessageNameEnum.") && args[2].includes("StageEnum.");
    if (!isPluginStep) {
      unrecognised.push({
        attribute: match[0],
        reason: "not a plug-in step (MessageNameEnum, entity, StageEnum, mode, filtering attributes, name, order, isolation) or a workflow activity",
      });
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
  }

  return { pluginSteps, workflowActivities, unrecognised };
}
