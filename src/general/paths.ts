import * as path from "path";

// Centralised path building so we never hand-concatenate a workspace path with a
// hard-coded separator. The old `fsPath + "\\" + name` pattern produced a single
// token like "project\dataverse-powertools.json" on macOS/Linux, so the settings
// file was never found and the extension failed to load project state off-Windows.
// No `vscode` import — keep it unit-testable.
export function workspaceFilePath(workspaceRoot: string, ...segments: string[]): string {
  return path.join(workspaceRoot, ...segments);
}
