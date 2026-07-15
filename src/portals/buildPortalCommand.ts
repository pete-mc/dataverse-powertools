// Command: build a whole portal's TypeScript (#150 #1 + #2). Walks the active
// portal component for `frontend/` and `backend/` sources, then builds each with
// the right pipeline — front-end → browser web file, backend (Server Logic) →
// single-script bundle + lint. `shared/` is inlined by esbuild into both.
// Convention-based (src/frontend, src/backend, src/shared); no live-site dependency.
// Registered once. Planning is pure + unit-tested in portalBuildPlan.ts.

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import DataversePowerToolsContext from "../context";
import { activeComponentRoot } from "../components/componentDiscovery";
import { planPortalBuild } from "./portalBuildPlan";
import { esbuildFrontendArgs, frontendOutputName } from "./portalFrontendBuild";
import { esbuildServerLogicArgs, stripModuleSyntax, serverLogicOutputName } from "./serverLogicBuild";
import { lintServerLogic, serverLogicPasses } from "./serverLogicLint";

const exec = util.promisify(require("child_process").exec);

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "bin" && e.name !== "obj" && !e.name.startsWith(".")) {
        walk(full, out);
      }
    } else if (/\.[cm]?tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

export async function buildPortal(context: DataversePowerToolsContext): Promise<void> {
  const root = activeComponentRoot(context) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showErrorMessage("Open a portal component first.");
    return;
  }

  const plan = planPortalBuild(walk(root));
  if (plan.frontend.length === 0 && plan.backend.length === 0) {
    vscode.window.showInformationMessage("No portal sources found. Put front-end TS under a 'frontend/' folder and Server Logic under 'backend/'.");
    return;
  }

  context.channel.show(true);
  context.channel.appendLine(`\nBuilding portal: ${plan.frontend.length} front-end, ${plan.backend.length} server-logic file(s).`);
  let built = 0;
  let failed = 0;
  let blocked = 0;

  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Building portal…" }, async () => {
    for (const file of plan.frontend) {
      const cwd = path.dirname(file);
      const entry = path.basename(file);
      try {
        await exec(`npx esbuild ${esbuildFrontendArgs(entry, frontendOutputName(entry)).join(" ")}`, { cwd });
        context.channel.appendLine(`✓ frontend  ${entry} → ${frontendOutputName(entry)}`);
        built++;
      } catch (error: unknown) {
        context.channel.appendLine(`✗ frontend  ${entry}: ${(error as { stderr?: string; message?: string }).stderr || (error as Error).message}`);
        failed++;
      }
    }

    for (const file of plan.backend) {
      const cwd = path.dirname(file);
      const entry = path.basename(file);
      const tmp = `${serverLogicOutputName(entry)}.esbuild.tmp`;
      try {
        await exec(`npx esbuild ${esbuildServerLogicArgs(entry, tmp).join(" ")}`, { cwd });
      } catch (error: unknown) {
        context.channel.appendLine(`✗ backend   ${entry}: ${(error as { stderr?: string; message?: string }).stderr || (error as Error).message}`);
        failed++;
        continue;
      }
      const tmpPath = path.join(cwd, tmp);
      const script = stripModuleSyntax(fs.readFileSync(tmpPath, "utf8"));
      fs.rmSync(tmpPath, { force: true });
      const outName = serverLogicOutputName(entry);
      fs.writeFileSync(path.join(cwd, outName), script, "utf8");

      const findings = lintServerLogic(script);
      if (serverLogicPasses(findings)) {
        context.channel.appendLine(`✓ backend   ${entry} → ${outName}${findings.length ? " (unsupported browser APIs)" : ""}`);
      } else {
        context.channel.appendLine(`⚠ backend   ${entry} → ${outName} — BLOCKED patterns (would be rejected on upload):`);
        findings.filter((f) => f.severity === "blocked").forEach((f) => context.channel.appendLine(`      line ${f.line} ${f.pattern}: ${f.message}`));
        blocked++;
      }
      built++;
    }
  });

  if (failed > 0 || blocked > 0) {
    vscode.window.showWarningMessage(`Portal build: ${built} built (${blocked} with blocked patterns), ${failed} failed. See the Dataverse PowerTools output.`);
  } else {
    vscode.window.showInformationMessage(`Portal build: ${built} file(s) built.`);
  }
}
