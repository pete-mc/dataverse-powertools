// Which Jest tests to re-run when a file changes, for the Test Explorer's continuous ("watch") run
// (#232). Pure so the decision is unit-tested without an editor.
//
// Why not `jest --watch`: that owns a long-lived child process, and orphaned watchers are a known
// failure mode in this repo (they starve the 8GB e2e VM until the editor host dies). Continuous run
// instead re-uses the ordinary one-shot `npx jest --json` path per change, so there is never a process
// to leak — VS Code's own continuous-run toggle starts and stops it, and cancelling disposes the file
// watcher with it.

import * as path from "path";

/** A Jest test file in a web-resources project: under `__tests__`, a `.ts` file, not a declaration. */
export function isTestFile(fsPath: string): boolean {
  const normalized = fsPath.replace(/\\/g, "/");
  return /\/__tests__\//.test(normalized) && normalized.endsWith(".ts") && !normalized.endsWith(".d.ts");
}

/** Source files that can affect tests — everything else (json, css, snapshots, build output) is ignored. */
export function isWatchableSource(fsPath: string): boolean {
  const normalized = fsPath.replace(/\\/g, "/");
  if (/\/(node_modules|dist|bin|out|obj|\.git)\//.test(normalized)) {
    return false;
  }
  return normalized.endsWith(".ts") && !normalized.endsWith(".d.ts");
}

/**
 * The test files to re-run for a change.
 *
 * A changed TEST file runs just itself — the tight loop you want while writing a test. A changed
 * SOURCE file runs every discovered test, because we do not have Jest's dependency graph and guessing
 * which tests cover a module would silently skip the ones that matter.
 */
export function testFilesToRerun(changedPath: string, allTestFiles: string[]): string[] {
  if (isTestFile(changedPath)) {
    const match = allTestFiles.find((f) => path.normalize(f).toLowerCase() === path.normalize(changedPath).toLowerCase());
    // A test file we have not discovered yet (just created) still runs — discovery catches up after.
    return match ? [match] : [changedPath];
  }
  if (!isWatchableSource(changedPath)) {
    return [];
  }
  return [...allTestFiles];
}

/** Collapse a burst of changes (a save-all, a git checkout) into one run's worth of test files. */
export function planBatch(changedPaths: string[], allTestFiles: string[]): string[] {
  const files = new Set<string>();
  for (const changed of changedPaths) {
    for (const file of testFilesToRerun(changed, allTestFiles)) {
      files.add(file);
    }
  }
  return [...files];
}
