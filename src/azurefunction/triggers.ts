// Azure Function trigger types (#145). PURE — no `vscode` import — so the trigger table and
// the template-file mapping are unit-testable.
//
// A Dataverse *webhook* is the headline case (the typed RemoteExecutionContext handler), but a
// function component is not required to be one: a project may just as well be a plain HTTP API,
// a scheduled timer, or a Service Bus consumer. The trigger is chosen at scaffold time, decides
// which sample handler is written, and is remembered in settings so the panel offers the right
// call-to-action (Register Webhook & Step only leads for webhook-triggered functions).

// NB: a Service Bus trigger is deliberately NOT offered yet. Dataverse can post the same
// RemoteExecutionContext to a Service Bus queue, but Worker.Extensions.ServiceBus and
// Microsoft.PowerPlatform.Dataverse.Client currently collide in the Functions WorkerExtensions
// sub-build (MSB3030: System.Security.Cryptography.ProtectedData.dll not found) — reproduced on
// Worker.Sdk 1.17.4 and 2.0.5, and an explicit ProtectedData reference doesn't fix it. Adding it
// would ship a template that doesn't compile. Tracked as a follow-up on #145.
export type AzureFunctionTrigger = "webhook" | "http" | "timer";

export interface AzureFunctionTriggerOption {
  id: AzureFunctionTrigger;
  label: string;
  description: string;
  /** The templates/azurefunction/<templateName>.cs/1.cs sample written for this trigger. */
  templateName: string;
  /** True when the trigger receives a Dataverse RemoteExecutionContext (webhook + Service Bus). */
  receivesDataverseContext: boolean;
}

export const AZURE_FUNCTION_TRIGGERS: readonly AzureFunctionTriggerOption[] = [
  {
    id: "webhook",
    label: "Dataverse webhook (HTTP)",
    description: "Dataverse fires a step at this function — typed RemoteExecutionContext payload",
    templateName: "OnAccountCreate",
    receivesDataverseContext: true,
  },
  {
    id: "http",
    label: "HTTP request",
    description: "A plain HTTP API endpoint (still gets the Dataverse ServiceClient callback)",
    templateName: "HttpApiFunction",
    receivesDataverseContext: false,
  },
  {
    id: "timer",
    label: "Timer (scheduled)",
    description: "Runs on a CRON schedule — e.g. a nightly Dataverse sync or cleanup job",
    templateName: "TimerFunction",
    receivesDataverseContext: false,
  },
];

/** The trigger scaffolded when the user doesn't choose (or the pick is dismissed). */
export const DEFAULT_AZURE_FUNCTION_TRIGGER: AzureFunctionTrigger = "webhook";

export function getTriggerOption(id: string | undefined): AzureFunctionTriggerOption {
  return AZURE_FUNCTION_TRIGGERS.find((t) => t.id === id) ?? AZURE_FUNCTION_TRIGGERS.find((t) => t.id === DEFAULT_AZURE_FUNCTION_TRIGGER)!;
}

/** Sample-handler template path segments for a trigger: templates/azurefunction/<name>.cs/1.cs */
export function triggerTemplatePath(id: string | undefined): string[] {
  return ["templates", "azurefunction", `${getTriggerOption(id).templateName}.cs`, "1.cs"];
}

/** The file name (…/<ClassName>.cs) the sample handler is written to in the component. */
export function triggerFileName(id: string | undefined): string {
  return `${getTriggerOption(id).templateName}.cs`;
}

/** Whether "Register Webhook & Step" is the natural primary action for this trigger — only the
 * Dataverse webhook. A timer or plain-HTTP function has no Dataverse registration, so it leads
 * with Build instead (the registration stays available: you can add a webhook handler later). */
export function leadsWithWebhookRegistration(id: string | undefined): boolean {
  return getTriggerOption(id).id === "webhook";
}
