import { describe, expect, it } from "vitest";
import { parseDecorationsFromContent } from "./decorationParser";

describe("parseDecorationsFromContent", () => {
  it("returns every stacked [CrmPluginRegistration] on one class as its own step (#295)", () => {
    const source = `
namespace Contoso.Plugins
{
    [CrmPluginRegistration(MessageNameEnum.Reschedule, "appointment", StageEnum.PreValidation, ExecutionModeEnum.Synchronous, "", "PreRescheduleValidateAppointment", 1, IsolationModeEnum.Sandbox, Id = "04874fdf-6c09-44d3-88a8-5cda8d16d901")]
    [CrmPluginRegistration(MessageNameEnum.Book, "appointment", StageEnum.PreValidation, ExecutionModeEnum.Synchronous, "", "PreBookValidateAppointment", 1, IsolationModeEnum.Sandbox, Id = "f4206194-8f0d-48bd-989b-5b23a4d989c6")]
    [CrmPluginRegistration(MessageNameEnum.Update, "appointment", StageEnum.PostOperation, ExecutionModeEnum.Asynchronous, "scheduledstart", "PostUpdateAppointment", 2, IsolationModeEnum.Sandbox)]
    public class PreValidateAppointmentSchedule : PluginBase
    {
    }
}`;
    const { pluginSteps, workflowActivities } = parseDecorationsFromContent(source);
    expect(workflowActivities).toEqual([]);
    expect(pluginSteps.map((step) => [step.className, step.fullTypeName, step.messageName, step.stepName, step.stepId])).toEqual([
      [
        "PreValidateAppointmentSchedule",
        "Contoso.Plugins.PreValidateAppointmentSchedule",
        "Reschedule",
        "PreRescheduleValidateAppointment",
        "04874fdf-6c09-44d3-88a8-5cda8d16d901",
      ],
      ["PreValidateAppointmentSchedule", "Contoso.Plugins.PreValidateAppointmentSchedule", "Book", "PreBookValidateAppointment", "f4206194-8f0d-48bd-989b-5b23a4d989c6"],
      ["PreValidateAppointmentSchedule", "Contoso.Plugins.PreValidateAppointmentSchedule", "Update", "PostUpdateAppointment", undefined],
    ]);
    expect(pluginSteps[2]).toMatchObject({ entityLogicalName: "appointment", stage: 40, mode: 1, filteringAttributes: "scheduledstart", executionOrder: 2 });
  });

  it("attributes each step to the class it decorates when a file has several classes", () => {
    const source = `
namespace Contoso.Plugins
{
    [CrmPluginRegistration(MessageNameEnum.Create, "account", StageEnum.PreOperation, ExecutionModeEnum.Synchronous, "", "Create account", 1, IsolationModeEnum.Sandbox)]
    public class AccountCreate : PluginBase { }

    [CrmPluginRegistration(MessageNameEnum.Delete, "contact", StageEnum.PreValidation, ExecutionModeEnum.Synchronous, "", "Delete contact", 1, IsolationModeEnum.Sandbox)]
    [CrmPluginRegistration(MessageNameEnum.Update, "contact", StageEnum.PreOperation, ExecutionModeEnum.Synchronous, "firstname", "Update contact", 1, IsolationModeEnum.Sandbox)]
    public class ContactChange : PluginBase { }

    [CrmPluginRegistration("WorkflowActivity", "My Activity", "Does a thing", "My Group", IsolationModeEnum.Sandbox)]
    public class MyActivity : WorkflowBase { }
}`;
    const { pluginSteps, workflowActivities } = parseDecorationsFromContent(source);
    expect(pluginSteps.map((step) => [step.className, step.messageName, step.stage])).toEqual([
      ["AccountCreate", "Create", 20],
      ["ContactChange", "Delete", 10],
      ["ContactChange", "Update", 20],
    ]);
    expect(workflowActivities).toEqual([
      { className: "MyActivity", fullTypeName: "Contoso.Plugins.MyActivity", workflowName: "My Activity", workflowDescription: "Does a thing", workflowGroup: "My Group" },
    ]);
  });
});
