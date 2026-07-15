// Pure arg builders for the Azure Functions Core Tools (`func`) — #145 issues
// #6/#7 (Azure publish + local run). No `vscode` → unit-tested. funcCommands.ts
// runs these in a VS Code terminal (long-lived host / interactive Azure prompts).

/** `func azure functionapp publish <app>` — deploy the built function to Azure. */
export function funcAzurePublishArgs(functionAppName: string): string[] {
  return ["azure", "functionapp", "publish", functionAppName];
}

/** `func start` — run the Functions host locally for the inner loop. */
export function funcStartArgs(): string[] {
  return ["start"];
}

/** A shell-safe command line from a program + args (quotes args containing spaces). */
export function toCommandLine(program: string, args: string[]): string {
  const quote = (a: string) => (/\s/.test(a) ? `"${a}"` : a);
  return [program, ...args.map(quote)].join(" ");
}
