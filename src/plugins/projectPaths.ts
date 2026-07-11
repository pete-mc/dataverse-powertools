import * as fs from "fs";
import * as path from "path";

const ignoredDirectoryNames = new Set([".git", "node_modules", "bin", "obj", ".vs"]);

function shouldIgnorePathSegment(segment: string): boolean {
  return ignoredDirectoryNames.has(segment.toLowerCase());
}

export async function walkDirectory(rootPath: string): Promise<string[]> {
  const results: string[] = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop() as string;
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (!shouldIgnorePathSegment(entry.name)) {
          stack.push(entryPath);
        }
      } else {
        results.push(entryPath);
      }
    }
  }

  return results;
}

/** Matches a CONCRETE class deriving from a plugin/workflow base — what makes the
 * built assembly a "plug-in assembly" to Dataverse. Abstract bases (PluginBase
 * itself, WorkflowBase itself) don't count. */
export function lineDeclaresDeployablePluginType(line: string): boolean {
  return /class\s+\w+[^:\n]*:\s*[^{\n]*\b(PluginBase|WorkflowBase|IPlugin|CodeActivity)\b/.test(line) && !/\babstract\b/.test(line);
}

/** True when any .cs source (outside bin/obj/tests) declares a concrete plugin or
 * workflow type. A package whose assembly has none is rejected by Dataverse
 * ("no plug-in assembly in the nuget file", 0x80040265) — callers use this to
 * fail fast with guidance instead. New projects scaffold without a sample class. */
export async function hasDeployablePluginTypes(workspacePath: string): Promise<boolean> {
  const allFiles = await walkDirectory(workspacePath);
  const sources = allFiles.filter((filePath) => filePath.toLowerCase().endsWith(".cs") && !isTestProjectPath(filePath));
  for (const file of sources) {
    const text = await fs.promises.readFile(file, "utf8");
    if (text.split("\n").some(lineDeclaresDeployablePluginType)) {
      return true;
    }
  }
  return false;
}

export function isTestProjectPath(csprojPath: string): boolean {
  const lowerPath = csprojPath.toLowerCase();
  return lowerPath.endsWith(".tests.csproj") || lowerPath.includes("\\tests\\") || lowerPath.includes("/tests/") || lowerPath.includes(".tests\\") || lowerPath.includes(".tests/");
}

export async function findPrimaryPluginCsproj(workspacePath: string, preferredProjectName?: string): Promise<string | undefined> {
  const allFiles = await walkDirectory(workspacePath);
  const projectFiles = allFiles.filter((filePath) => filePath.toLowerCase().endsWith(".csproj") && !isTestProjectPath(filePath));
  if (projectFiles.length === 0) {
    return undefined;
  }

  if (preferredProjectName) {
    const preferred = projectFiles
      .filter((filePath) => path.basename(filePath, ".csproj").toLowerCase() === preferredProjectName.toLowerCase())
      .sort((a, b) => a.localeCompare(b))[0];

    if (preferred) {
      return preferred;
    }
  }

  const sorted = projectFiles.sort((a, b) => {
    const aDepth = a.split(path.sep).length;
    const bDepth = b.split(path.sep).length;
    if (aDepth !== bDepth) {
      return aDepth - bDepth;
    }

    return a.localeCompare(b);
  });

  return sorted[0];
}
