import * as vscode from 'vscode';
import * as cp from "child_process";
import { generateEarlyBound } from './plugins/earlybound';
import { buildDeployPlugin } from './plugins/buildDeployPlugin';
import { buildDeployWorkflow } from './plugins/buildDeployWorkflow';
import path = require('path');
import fs = require('fs');
import { buildWebresources } from './webresources/buildWebresources';
import { deployWebresources } from './webresources/deployWebresources';
import { generateTypings } from './webresources/generateTypings';

export function activate(context: vscode.ExtensionContext) {
	const chan = vscode.window.createOutputChannel("dataverse-powertools");
	context.subscriptions.push(vscode.commands.registerCommand('dataverse-powertools.generateEarlyBound', () => generateEarlyBound(chan)));
	context.subscriptions.push(vscode.commands.registerCommand('dataverse-powertools.buildDeployPlugin', () => buildDeployPlugin(chan,context)));
	context.subscriptions.push(vscode.commands.registerCommand('dataverse-powertools.buildDeployWorkflow', () => buildDeployWorkflow(chan)));
	context.subscriptions.push(vscode.commands.registerCommand('dataverse-powertools.buildWebresources', () => buildWebresources(chan)));
	context.subscriptions.push(vscode.commands.registerCommand('dataverse-powertools.deployWebresources', () => deployWebresources(chan)));
	context.subscriptions.push(vscode.commands.registerCommand('dataverse-powertools.generateTypings', () => generateTypings(chan)));

	// let fullFilePath = context.asAbsolutePath(path.join('templates', 'test.txt'));
	// let data = fs.readFileSync(fullFilePath, 'utf8');
	// chan.appendLine(data);

}

// this method is called when your extension is deactivated
export function deactivate() {}


