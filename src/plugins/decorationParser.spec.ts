import { describe, expect, it } from "vitest";
import { parseDecorationsFromContent, stripCSharpComments } from "./decorationParser";
import { StepImageType } from "../general/dataverse/stepPayloads";

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

  it("ignores commented-out registrations, line and block", () => {
    const source = `
namespace Contoso.Plugins
{
    // [CrmPluginRegistration(MessageNameEnum.Delete, "account", StageEnum.PreValidation, ExecutionModeEnum.Synchronous, "", "Disabled delete", 1, IsolationModeEnum.Sandbox)]
    /* [CrmPluginRegistration(MessageNameEnum.Assign, "account", StageEnum.PreValidation, ExecutionModeEnum.Synchronous, "", "Disabled assign", 1, IsolationModeEnum.Sandbox)] */
    [CrmPluginRegistration(MessageNameEnum.Create, "account", StageEnum.PostOperation, ExecutionModeEnum.Synchronous, "", "Live create", 1, IsolationModeEnum.Sandbox)]
    public class AccountPlugin : PluginBase { }
}`;
    const { pluginSteps, unrecognised } = parseDecorationsFromContent(source);
    expect(pluginSteps.map((step) => step.stepName)).toEqual(["Live create"]);
    expect(unrecognised).toEqual([]);
  });

  it("registers steps on sealed and partial classes", () => {
    const source = `
namespace Contoso.Plugins
{
    [CrmPluginRegistration(MessageNameEnum.Create, "account", StageEnum.PostOperation, ExecutionModeEnum.Synchronous, "", "Sealed create", 1, IsolationModeEnum.Sandbox)]
    public sealed class SealedPlugin : PluginBase { }

    [CrmPluginRegistration(MessageNameEnum.Update, "account", StageEnum.PostOperation, ExecutionModeEnum.Synchronous, "", "Partial update", 1, IsolationModeEnum.Sandbox)]
    public partial class PartialPlugin : PluginBase { }
}`;
    expect(parseDecorationsFromContent(source).pluginSteps.map((step) => [step.className, step.stepName])).toEqual([
      ["SealedPlugin", "Sealed create"],
      ["PartialPlugin", "Partial update"],
    ]);
  });

  it("reports attributes it cannot register instead of dropping them silently", () => {
    const source = `
namespace Contoso.Plugins
{
    [CrmPluginRegistration(MessageNameEnum.Create, "account")]
    public class Incomplete : PluginBase { }

    [CrmPluginRegistration(MessageNameEnum.Update, "account", StageEnum.PostOperation, ExecutionModeEnum.Synchronous, "", "Orphan", 1, IsolationModeEnum.Sandbox)]
    internal class NotPublic : PluginBase { }
}`;
    const { pluginSteps, unrecognised } = parseDecorationsFromContent(source);
    expect(pluginSteps).toEqual([]);
    expect(unrecognised.map((entry) => entry.reason)).toEqual([expect.stringContaining("not a plug-in step"), "no public class declaration follows it"]);
  });

  it("keeps // and /* inside string literals when stripping comments", () => {
    expect(stripCSharpComments('var a = "http://x"; // gone\nvar b = @"C:\\a ""//"" b"; /* gone */ var c = \'/\';')).toBe(
      'var a = "http://x"; \nvar b = @"C:\\a ""//"" b";   var c = \'/\';',
    );
  });
});

describe("parseDecorationsFromContent — step images", () => {
  const parse = (namedArgs: string) =>
    parseDecorationsFromContent(`
namespace Contoso.Plugins
{
    [CrmPluginRegistration(MessageNameEnum.Update, "contact", StageEnum.PostOperation, ExecutionModeEnum.Synchronous, "emailaddress1", "PostUpdateContact", 1, IsolationModeEnum.Sandbox${namedArgs})]
    public class PostUpdateContact : PluginBase { }
}`);

  it("reads Image1 and Image2 with their types and attributes", () => {
    const { pluginSteps, warnings } = parse(
      ', Id = "0c93bd74-909b-4c51-8d64-f3d55714bd94", Image1Type = ImageTypeEnum.PreImage, Image1Name = "PreImage", Image1Attributes = "emailaddress1,firstname", Image2Type = ImageTypeEnum.PostImage, Image2Name = "PostImage"',
    );
    expect(warnings).toEqual([]);
    expect(pluginSteps[0].stepId).toBe("0c93bd74-909b-4c51-8d64-f3d55714bd94");
    expect(pluginSteps[0].images).toEqual([
      { name: "PreImage", imageType: StepImageType.preImage, attributes: "emailaddress1,firstname" },
      { name: "PostImage", imageType: StepImageType.postImage, attributes: undefined },
    ]);
  });

  it("defaults the image type to PreImage and accepts Both", () => {
    expect(parse(', Image1Name = "Snapshot"').pluginSteps[0].images).toEqual([{ name: "Snapshot", imageType: StepImageType.preImage, attributes: undefined }]);
    expect(parse(', Image1Name = "Snapshot", Image1Type = ImageTypeEnum.Both').pluginSteps[0].images?.[0].imageType).toBe(StepImageType.both);
  });

  it("omits images when none are declared", () => {
    expect(parse("").pluginSteps[0]).not.toHaveProperty("images");
  });

  it("still registers the step but warns when an image name is not a string literal", () => {
    const { pluginSteps, warnings } = parse(', Image1Type = ImageTypeEnum.PreImage, Image1Name = PreImageAlias, Image1Attributes = "emailaddress1"');
    expect(pluginSteps).toHaveLength(1);
    expect(pluginSteps[0]).not.toHaveProperty("images");
    expect(warnings).toEqual([expect.stringContaining("Image1Name and Image1Attributes must be string literals")]);
  });

  it("warns when image properties are set without a name", () => {
    expect(parse(', Image1Attributes = "emailaddress1"').warnings).toEqual([expect.stringContaining("Image1Name is not set")]);
  });

  it("warns on an unknown image type", () => {
    expect(parse(', Image1Name = "PreImage", Image1Type = (ImageTypeEnum)7').warnings).toEqual([expect.stringContaining("is not an ImageTypeEnum value")]);
  });
});
