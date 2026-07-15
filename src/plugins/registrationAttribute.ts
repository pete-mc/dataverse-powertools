// Pure parsing of `[CrmPluginRegistration(...)]` plugin-step attributes (#139), kept
// `vscode`-free so the source-registration → server-step matcher is unit-testable. Plugin
// steps are positional: (MessageNameEnum.X, "entity", StageEnum.Y, ExecutionModeEnum.Z,
// "filtering", "stepName", order, IsolationModeEnum.W, ...).

export interface ParsedRegistration {
  message?: string;
  primaryEntity?: string;
  stage?: string;
}

/** Split a top-level comma-separated argument list, respecting C# strings and nested parens. Pure. */
export function splitTopLevelArgs(argsText: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = 0;
  for (let i = 0; i < argsText.length; i++) {
    const char = argsText[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === 0) {
      args.push(argsText.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(argsText.slice(start).trim());
  return args;
}

function unquote(arg: string | undefined): string | undefined {
  const trimmed = (arg ?? "").trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return undefined;
}

function enumMember(arg: string | undefined, enumName: string): string | undefined {
  const trimmed = (arg ?? "").trim();
  const token = `${enumName}.`;
  const index = trimmed.indexOf(token);
  return index >= 0 ? trimmed.slice(index + token.length).trim() : undefined;
}

/** Parse a plugin-step registration's args text (inside the parens). Undefined for a
 * non-plugin-step attribute (e.g. a WorkflowActivity registration). Pure. */
export function parseRegistrationArgs(argsText: string): ParsedRegistration | undefined {
  const args = splitTopLevelArgs(argsText);
  const message = enumMember(args[0], "MessageNameEnum");
  const stage = enumMember(args[2], "StageEnum");
  if (!message || !stage) {
    return undefined;
  }
  return { message, primaryEntity: unquote(args[1]), stage };
}
