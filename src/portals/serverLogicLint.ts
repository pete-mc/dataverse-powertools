// Pure lint for Power Pages Server Logic (#150, issue #2). Server Logic runs in a
// restricted ES2023 sandbox that rejects a fixed list of patterns (dynamic code,
// process control, prototype manipulation, module syntax) and has no browser APIs.
// Catching these locally gives a clear message instead of a cryptic server-side
// rejection on upload. No `vscode` import → unit-testable.
//
// Pattern list is from the official docs:
//   https://learn.microsoft.com/power-pages/configure/author-server-logic#limitations

export type ServerLogicSeverity = "blocked" | "unsupported";

export interface ServerLogicFinding {
  /** 1-based line number. */
  line: number;
  /** The offending pattern label. */
  pattern: string;
  message: string;
  severity: ServerLogicSeverity;
}

interface LintRule {
  pattern: string;
  regex: RegExp;
  severity: ServerLogicSeverity;
  message: string;
}

// "blocked" = the platform validator rejects the script; "unsupported" = present
// but non-functional server-side (browser APIs). All should be fixed before upload.
const RULES: LintRule[] = [
  {
    pattern: "import",
    regex: /\bimport\s*\(|\bimport\b[^\n]*\bfrom\b|^\s*import\s+["']/m,
    severity: "blocked",
    message: "Module syntax (import) is not allowed — bundle shared code inline instead.",
  },
  { pattern: "require(", regex: /\brequire\s*\(/, severity: "blocked", message: "require() is not allowed — bundle dependencies inline." },
  { pattern: "eval(", regex: /\beval\s*\(/, severity: "blocked", message: "eval() is not allowed (dynamic code execution)." },
  { pattern: "Function(", regex: /\bnew\s+Function\s*\(|\bFunction\s*\(/, severity: "blocked", message: "The Function constructor is not allowed (dynamic code execution)." },
  { pattern: "setTimeout(", regex: /\bsetTimeout\s*\(/, severity: "blocked", message: "setTimeout is not allowed." },
  { pattern: "setInterval(", regex: /\bsetInterval\s*\(/, severity: "blocked", message: "setInterval is not allowed." },
  { pattern: "setImmediate(", regex: /\bsetImmediate\s*\(/, severity: "blocked", message: "setImmediate is not allowed." },
  { pattern: "process.exit", regex: /\bprocess\.exit\b/, severity: "blocked", message: "process.exit is not allowed." },
  { pattern: "process.kill", regex: /\bprocess\.kill\b/, severity: "blocked", message: "process.kill is not allowed." },
  { pattern: "child_process", regex: /\bchild_process\b/, severity: "blocked", message: "child_process is not allowed." },
  { pattern: "fs.", regex: /\bfs\s*\./, severity: "blocked", message: "File-system access (fs.) is not allowed." },
  { pattern: "__dirname", regex: /\b__dirname\b/, severity: "blocked", message: "__dirname is not allowed." },
  { pattern: "__filename", regex: /\b__filename\b/, severity: "blocked", message: "__filename is not allowed." },
  { pattern: "constructor.constructor", regex: /\bconstructor\s*\.\s*constructor\b/, severity: "blocked", message: "constructor.constructor is not allowed (sandbox escape)." },
  { pattern: "this.constructor", regex: /\bthis\s*\.\s*constructor\b/, severity: "blocked", message: "this.constructor is not allowed (sandbox escape)." },
  { pattern: "arguments.callee", regex: /\barguments\s*\.\s*callee\b/, severity: "blocked", message: "arguments.callee is not allowed." },
  { pattern: "with(", regex: /\bwith\s*\(/, severity: "blocked", message: "with statements are not allowed." },
  { pattern: "delete", regex: /\bdelete\s+[A-Za-z_$]/, severity: "blocked", message: "The delete operator is not allowed." },
  { pattern: "Object.getPrototypeOf", regex: /\bObject\s*\.\s*getPrototypeOf\b/, severity: "blocked", message: "Object.getPrototypeOf is not allowed (prototype manipulation)." },
  { pattern: "Object.setPrototypeOf", regex: /\bObject\s*\.\s*setPrototypeOf\b/, severity: "blocked", message: "Object.setPrototypeOf is not allowed (prototype manipulation)." },
  { pattern: "Proxy(", regex: /\bnew\s+Proxy\s*\(|\bProxy\s*\(/, severity: "blocked", message: "Proxy is not allowed." },
  { pattern: "Reflect.", regex: /\bReflect\s*\./, severity: "blocked", message: "Reflect is not allowed." },
  { pattern: "Symbol.for", regex: /\bSymbol\s*\.\s*for\b/, severity: "blocked", message: "Symbol.for is not allowed." },
  { pattern: "__proto__", regex: /\b__proto__\b/, severity: "blocked", message: "__proto__ is not allowed (prototype manipulation)." },
  { pattern: "prototype", regex: /\bprototype\b/, severity: "blocked", message: "Accessing prototype is not allowed (prototype manipulation)." },
  { pattern: "debugger", regex: /\bdebugger\b/, severity: "blocked", message: "debugger statements are not allowed." },
  { pattern: "fetch(", regex: /\bfetch\s*\(/, severity: "unsupported", message: "fetch is a browser API and is unavailable server-side." },
  { pattern: "XMLHttpRequest", regex: /\bXMLHttpRequest\b/, severity: "unsupported", message: "XMLHttpRequest is a browser API and is unavailable server-side." },
];

/**
 * Best-effort strip of comments and string/template literals so patterns inside
 * them don't cause false positives. Not a full parser — good enough for a lint.
 */
export function stripCommentsAndStrings(code: string): string {
  let out = code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")); // block comments (keep newlines)
  out = out.replace(/\/\/[^\n]*/g, ""); // line comments
  // Replace string / template contents with spaces (keep quotes + length rough).
  out = out.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, (m) => m[0] + " ".repeat(Math.max(0, m.length - 2)) + m[0]);
  return out;
}

/**
 * Lint a Server Logic script for blocked / unsupported patterns. Returns findings
 * with 1-based line numbers, in source order.
 */
export function lintServerLogic(code: string): ServerLogicFinding[] {
  const stripped = stripCommentsAndStrings(code);
  const lines = stripped.split(/\r?\n/);
  const findings: ServerLogicFinding[] = [];

  lines.forEach((line, index) => {
    for (const rule of RULES) {
      // Fresh test per line (regexes here are non-global, so no lastIndex state).
      if (rule.regex.test(line)) {
        findings.push({ line: index + 1, pattern: rule.pattern, message: rule.message, severity: rule.severity });
      }
    }
  });

  return findings;
}

/** Convenience: true when no blocked patterns are present (unsupported warnings allowed). */
export function serverLogicPasses(findings: ServerLogicFinding[]): boolean {
  return !findings.some((f) => f.severity === "blocked");
}
