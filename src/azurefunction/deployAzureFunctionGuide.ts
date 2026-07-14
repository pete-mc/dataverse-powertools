import * as vscode from "vscode";
import DataversePowerToolsContext from "../context";

const PUBLISH_DOCS_URL = "https://learn.microsoft.com/azure/azure-functions/functions-develop-vs-code?tabs=csharp#publish-to-azure";

// v1 (#145) deliberately does NOT invoke `func azure functionapp publish` / `az` — Azure
// publish is deferred (#145 item 6), and neither tool is a system requirement of this
// extension. This command is a GUIDE: it points at the supported publish routes and leaves
// the invocation to the user. Once the function is published, "Register webhook & step"
// wires the resulting URL + host key into Dataverse.
export async function deployAzureFunctionGuide(context: DataversePowerToolsContext): Promise<void> {
  const message = [
    "Publishing to Azure is not automated yet.",
    "Publish with the Azure Functions extension (Deploy to Function App…), `func azure functionapp publish <app>`, or the Azure portal,",
    "then run 'Register Webhook & Step' with the function URL and host key to wire it into Dataverse.",
  ].join(" ");
  context.channel.appendLine(`[Azure Function] ${message}`);

  const choice = await vscode.window.showInformationMessage(
    "Publish this function with the Azure Functions extension / func CLI / Azure portal, then run 'Register Webhook & Step' to wire it into Dataverse.",
    "Publish docs",
  );
  if (choice === "Publish docs") {
    void vscode.env.openExternal(vscode.Uri.parse(PUBLISH_DOCS_URL));
  }
}
