// Pure planning for a portal-wide build (#150, #1 + #2 combined). Given the TS
// source files in a portal, classify each by its role so the command knows which
// pipeline to run: `frontend/` → browser web-file bundle, `backend/` → Server
// Logic single-script bundle. `shared/` is inlined into both by esbuild, so it's
// never built on its own. Convention-based (no live-site dependency); no `vscode`.

import * as path from "path";

export interface PortalBuildPlan {
  /** Front-end entry files → browser web-file bundle. */
  frontend: string[];
  /** Back-end (Server Logic) entry files → single-script bundle + lint. */
  backend: string[];
}

/** Which portal role a file path belongs to (by its nearest `frontend`/`backend`/`shared` segment). */
export function classifyPortalFile(filePath: string): "frontend" | "backend" | "shared" | "other" {
  const segments = filePath.split(/[\\/]/);
  // The last matching role segment wins (handles nested shared under frontend, etc.).
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i].toLowerCase();
    if (s === "frontend" || s === "backend" || s === "shared") {
      return s;
    }
  }
  return "other";
}

/** Only top-level entries build; files under `_`-prefixed or nested `shared` dirs, and
 * `.d.ts` / spec / test files, are helpers — not build targets. */
function isBuildableEntry(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (base.endsWith(".d.ts") || /\.(spec|test)\.[cm]?tsx?$/.test(base)) {
    return false;
  }
  return /\.[cm]?tsx?$/.test(base);
}

/** Build the plan from a flat list of TS files found under the portal. */
export function planPortalBuild(files: string[]): PortalBuildPlan {
  const plan: PortalBuildPlan = { frontend: [], backend: [] };
  for (const file of files) {
    if (!isBuildableEntry(file)) {
      continue;
    }
    const role = classifyPortalFile(file);
    if (role === "frontend") {
      plan.frontend.push(file);
    } else if (role === "backend") {
      plan.backend.push(file);
    }
    // shared / other → not a standalone target (inlined by esbuild).
  }
  return plan;
}
