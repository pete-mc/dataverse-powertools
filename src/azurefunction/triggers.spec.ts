import { describe, it, expect } from "vitest";
import { AZURE_FUNCTION_TRIGGERS, DEFAULT_AZURE_FUNCTION_TRIGGER, getTriggerOption, triggerTemplatePath, triggerFileName, leadsWithWebhookRegistration } from "./triggers";

describe("Azure Function triggers (#145 — webhook is the default, not the only, shape)", () => {
  it("offers webhook, plain HTTP and timer", () => {
    // Service Bus is deliberately absent: Worker.Extensions.ServiceBus collides with
    // Dataverse.Client in the Functions WorkerExtensions build (MSB3030), so offering it
    // would scaffold a project that doesn't compile. See the note in triggers.ts.
    expect(AZURE_FUNCTION_TRIGGERS.map((t) => t.id)).toEqual(["webhook", "http", "timer"]);
  });

  it("defaults to the Dataverse webhook", () => {
    expect(DEFAULT_AZURE_FUNCTION_TRIGGER).toBe("webhook");
    // An unset/unknown trigger (e.g. a component scaffolded before this setting existed)
    // falls back to the webhook handler rather than breaking.
    expect(getTriggerOption(undefined).id).toBe("webhook");
    expect(getTriggerOption("nonsense").id).toBe("webhook");
  });

  it("maps each trigger to its own sample handler template", () => {
    expect(triggerTemplatePath("webhook")).toEqual(["templates", "azurefunction", "OnAccountCreate.cs", "1.cs"]);
    expect(triggerTemplatePath("http")).toEqual(["templates", "azurefunction", "HttpApiFunction.cs", "1.cs"]);
    expect(triggerTemplatePath("timer")).toEqual(["templates", "azurefunction", "TimerFunction.cs", "1.cs"]);
    expect(triggerFileName("timer")).toBe("TimerFunction.cs");
  });

  it("knows which triggers receive a Dataverse RemoteExecutionContext", () => {
    expect(getTriggerOption("webhook").receivesDataverseContext).toBe(true);
    expect(getTriggerOption("http").receivesDataverseContext).toBe(false);
    expect(getTriggerOption("timer").receivesDataverseContext).toBe(false);
  });

  it("only leads with Register Webhook & Step for the Dataverse webhook trigger", () => {
    // A timer or plain-HTTP function has no Dataverse registration, so Build leads instead —
    // the registration stays available on the card either way.
    expect(leadsWithWebhookRegistration("webhook")).toBe(true);
    expect(leadsWithWebhookRegistration("http")).toBe(false);
    expect(leadsWithWebhookRegistration("timer")).toBe(false);
  });
});
