// Pure helpers for scaffolding a new plugin class with the project's early-bound namespace
// (#131). Kept vscode-free so the "active using vs commented hint" decision is unit-tested —
// the decision matters because a `using` for a namespace with no types yet is a CS0246
// compile error, so a class created before "Generate Earlybound" must NOT emit an active using.

export const DEFAULT_EARLYBOUND_NAMESPACE = "Dataverse.Plugins";
export const DEFAULT_SERVICE_CONTEXT = "XrmSvc";

/**
 * The line that replaces EARLYBOUNDUSINGPLACEHOLDER in the plugin class template.
 *
 * - When early-bound types have been generated, emit an active `using <ns>;` so the generated
 *   types resolve immediately.
 * - Otherwise emit a commented hint — an active using for an as-yet-empty namespace would fail
 *   to compile (CS0246).
 */
export function earlyboundUsingLine(namespace: string | undefined, hasGeneratedTypes: boolean): string {
  const ns = (namespace && namespace.trim()) || DEFAULT_EARLYBOUND_NAMESPACE;
  return hasGeneratedTypes ? `using ${ns};` : `// using ${ns};  // early-bound types - run "Generate Earlybound" to create them`;
}
