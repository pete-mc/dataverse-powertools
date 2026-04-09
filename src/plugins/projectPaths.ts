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

function isTestProjectPath(csprojPath: string): boolean {
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
