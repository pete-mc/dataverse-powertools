import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";
import { addClassDecoration, updateFilteringAttributes } from "./decorations";

function inheritsSupportedBase(inheritanceClause: string): boolean {
  return /\bPluginBase\b/.test(inheritanceClause) || /\bWorkflowBase\b/.test(inheritanceClause) || /\bCodeActivity\b/.test(inheritanceClause);
}

async function focusLineInEditor(uri: vscode.Uri, line: number): Promise<vscode.TextEditor | undefined> {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const position = new vscode.Position(line, 0);
  const selection = new vscode.Selection(position, position);
  editor.selection = selection;
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return editor;
}

async function focusDecorationTokenInEditor(uri: vscode.Uri, line: number): Promise<vscode.TextEditor | undefined> {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const lineText = document.lineAt(line).text;
  const token = "[CrmPluginRegistration(";
  const tokenIndex = lineText.indexOf(token);
  const character = tokenIndex >= 0 ? tokenIndex : document.lineAt(line).firstNonWhitespaceCharacterIndex;
  const position = new vscode.Position(line, Math.max(0, character));
  const selection = new vscode.Selection(position, position);
  editor.selection = selection;
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return editor;
}

class DecorationCodeLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== "csharp" || !document.fileName.toLowerCase().endsWith(".cs")) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];
    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      const lineText = document.lineAt(lineIndex).text;
      const classMatch = lineText.match(/^\s*public\s+class\s+\w+\s*:\s*([^\{]+)$/);
      if (!classMatch) {
        continue;
      }

      if (!inheritsSupportedBase(classMatch[1] || "")) {
        continue;
      }

      codeLenses.push(
        new vscode.CodeLens(new vscode.Range(lineIndex, 0, lineIndex, 0), {
          title: "Dataverse: Add Class Decoration",
          command: "dataverse-powertools.addClassDecorationAtLine",
          arguments: [document.uri, lineIndex],
        }),
      );
    }

    const fullText = document.getText();
    const decorationRegex = /\[CrmPluginRegistration\(([\s\S]*?)\)\]/g;
    let match = decorationRegex.exec(fullText);
    while (match) {
      const argsText = match[1] || "";
      const isPluginStep = argsText.includes("StageEnum.") && argsText.includes("MessageNameEnum.");
      if (isPluginStep) {
        const start = document.positionAt(match.index);
        codeLenses.push(
          new vscode.CodeLens(new vscode.Range(start.line, 0, start.line, 0), {
            title: "Dataverse: Update Filtering Attributes",
            command: "dataverse-powertools.updateFilteringAttributesAtLine",
            arguments: [document.uri, start.line],
          }),
        );
      }

      match = decorationRegex.exec(fullText);
    }

    return codeLenses;
  }
}

export function registerDecorationCodeLens(context: DataversePowerToolsContext): void {
  context.vscode.subscriptions.push(
    vscode.commands.registerCommand("dataverse-powertools.addClassDecorationAtLine", async (uri: vscode.Uri, line: number) => {
      await focusLineInEditor(uri, line);
      await addClassDecoration(context);
    }),
  );

  context.vscode.subscriptions.push(
    vscode.commands.registerCommand("dataverse-powertools.updateFilteringAttributesAtLine", async (uri: vscode.Uri, line: number) => {
      await focusDecorationTokenInEditor(uri, line);
      await updateFilteringAttributes(context, line);
    }),
  );

  context.vscode.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      {
        language: "csharp",
        scheme: "file",
      },
      new DecorationCodeLensProvider(),
    ),
  );
}
