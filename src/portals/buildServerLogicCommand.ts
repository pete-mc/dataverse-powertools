// Command: build the active TypeScript file into a Power Pages Server Logic script
// (#150 #2). Runs esbuild to bundle it (inlining shared imports) into one ES2023
// file, strips the module syntax esbuild emits, lints the result against the
// Server Logic blocked-pattern list, and writes `<name>.serverlogic.js` — the
// self-contained classic script OOTB `pac powerpages upload` expects. Registered
// once, globally. Pure logic (args / strip) is unit-tested in serverLogicBuild.ts.
//
// Requires esbuild available in the file's project (`npx esbuild`). Pre-release.

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import DataversePowerToolsContext from "../context";
import { esbuildServerLogicArgs, stripModuleSyntax, serverLogicOutputName } from "./serverLogicBuild";
import { lintServerLogic, serverLogicPasses } from "./serverLogicLint";

const exec = util.promisify(require("child_process").exec);

export function registerServerLogicBuild(context: DataversePowerToolsContext): void {
  context.vscode.subscriptions.push(vscode.commands.registerCommand("dataverse-powertools.buildServerLogic", () => buildActiveFile(context)));
}

async function buildActiveFile(context: DataversePowerToolsContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !/\.[cm]?tsx?$/i.test(editor.document.fileName)) {
    vscode.window.showInformationMessage("Open the Server Logic TypeScript file you want to build.");
    return;
  }

  await editor.document.save();
  const filePath = editor.document.fileName;
  const cwd = path.dirname(filePath);
  const entry = path.basename(filePath);
  const tmpOut = `${serverLogicOutputName(entry)}.esbuild.tmp`;
  const finalName = serverLogicOutputName(entry);

  context.channel.appendLine(`\nBuilding Server Logic: ${entry} → ${finalName}`);
  try {
    await exec(`npx esbuild ${esbuildServerLogicArgs(entry, tmpOut).join(" ")}`, { cwd });
  } catch (error: unknown) {
    context.channel.appendLine(`esbuild failed: ${(error as { stderr?: string; message?: string }).stderr || (error as Error).message}`);
    context.channel.show(true);
    vscode.window.showErrorMessage("Server Logic build failed (is esbuild installed in this project?). See the Dataverse PowerTools output.");
    return;
  }

  const tmpPath = path.join(cwd, tmpOut);
  const bundled = fs.readFileSync(tmpPath, "utf8");
  fs.rmSync(tmpPath, { force: true });

  const script = stripModuleSyntax(bundled);
  const finalPath = path.join(cwd, finalName);
  fs.writeFileSync(finalPath, script, "utf8");

  const findings = lintServerLogic(script);
  if (findings.length === 0) {
    vscode.window.showInformationMessage(`Built ${finalName} — no blocked patterns. ✅`);
  } else {
    const blocked = findings.filter((f) => f.severity === "blocked").length;
    context.channel.appendLine(`Server Logic lint on the bundled output — ${blocked} blocked, ${findings.length - blocked} unsupported:`);
    findings.forEach((f) => context.channel.appendLine(`  line ${f.line} [${f.severity}] ${f.pattern}: ${f.message}`));
    context.channel.show(true);
    const verdict = serverLogicPasses(findings) ? "has unsupported browser APIs" : "would be REJECTED on upload";
    vscode.window.showWarningMessage(`Built ${finalName}, but it ${verdict}. See the output.`);
  }
}
