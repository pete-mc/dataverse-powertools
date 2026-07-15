// Pure core for the Language Model Tools surface (#140) — no `vscode` import, so
// the tool list, the read/mutate access-mode gate, and the (secret-free) output
// formatters are unit-tested here. registerLmTools.ts is the thin vscode binding
// that reads context + calls executeCommand. Handlers are kept as thin wrappers
// over the same command paths the UI uses, so a future MCP surface can reuse them.

/** Read-only (default) vs read-write. Mutating tools require read-write. */
export type AccessMode = "readonly" | "readwrite";

export interface LmToolSpec {
  /** Tool name, matching the package.json languageModelTools contribution. */
  name: string;
  /** Command executed by a mutating tool (via runForComponent's normal targeting). */
  command?: string;
  /** True for tools that change Dataverse / the workspace — gated + confirmed. */
  mutating: boolean;
  /** Title shown in the prepareInvocation confirmation for mutating tools. */
  confirmTitle?: string;
}

/** The curated v1 tool list. Read tools are always available; mutating tools are
 * gated on read-write access mode and confirmed per call. */
export const LM_TOOLS: readonly LmToolSpec[] = [
  { name: "dvpt_connectionStatus", mutating: false },
  { name: "dvpt_listComponents", mutating: false },
  { name: "dvpt_systemRequirements", mutating: false },
  { name: "dvpt_deploy", command: "dataverse-powertools.buildAndDeploy", mutating: true, confirmTitle: "Build & deploy to Dataverse" },
  { name: "dvpt_generateEarlybound", command: "dataverse-powertools.generateEarlyBound", mutating: true, confirmTitle: "Generate early-bound classes" },
];

/** Whether a tool may run under the given access mode. */
export function isToolAllowed(spec: LmToolSpec, accessMode: AccessMode): boolean {
  return spec.mutating ? accessMode === "readwrite" : true;
}

/** Message returned when a mutating tool is invoked in read-only mode. */
export function readOnlyRefusal(toolName: string): string {
  return (
    `The "${toolName}" tool changes your Dataverse environment and is disabled in read-only mode. ` + `Set "dataverse-powertools.copilot.accessMode" to "readwrite" to allow it.`
  );
}

export interface ConnectionSummaryInput {
  loaded: boolean;
  organizationUrl?: string;
  authType?: "oauth" | "clientsecret";
  connected: boolean;
}

/** Human-readable connection summary — never includes secrets or tokens. */
export function formatConnectionSummary(input: ConnectionSummaryInput): string {
  if (!input.loaded) {
    return "No Dataverse PowerTools project is loaded in this workspace.";
  }
  const auth = input.authType === "oauth" ? "interactive (OAuth)" : "service principal";
  const status = input.connected ? "connected" : "not connected yet (no token acquired)";
  return [`Organization: ${input.organizationUrl ?? "(unknown)"}`, `Auth type: ${auth}`, `Status: ${status}`].join("\n");
}

export interface ComponentSummaryInput {
  type: string;
  name: string;
  relativeRoot: string;
  isRoot: boolean;
}

export function formatComponentList(components: ComponentSummaryInput[]): string {
  if (components.length === 0) {
    return "No components have been discovered in this workspace.";
  }
  return components.map((c) => `- ${c.type}: ${c.name}${c.isRoot ? " (root)" : c.relativeRoot ? ` (${c.relativeRoot})` : ""}`).join("\n");
}

export interface RequirementSummaryInput {
  name: string;
  installed: boolean;
}

export function formatRequirements(requirements: RequirementSummaryInput[]): string {
  if (requirements.length === 0) {
    return "No system requirements are being tracked.";
  }
  return requirements.map((r) => `- ${r.name}: ${r.installed ? "installed" : "MISSING"}`).join("\n");
}
