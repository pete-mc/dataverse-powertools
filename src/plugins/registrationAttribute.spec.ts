import { describe, expect, it } from "vitest";
import { parseRegistrationArgs, splitTopLevelArgs } from "./registrationAttribute";

describe("CrmPluginRegistration attribute parsing", () => {
  it("splits args respecting strings and nested parens", () => {
    expect(splitTopLevelArgs('MessageNameEnum.Update, "account", StageEnum.PostOperation, "a,b", "Step, Name"')).toEqual([
      "MessageNameEnum.Update",
      '"account"',
      "StageEnum.PostOperation",
      '"a,b"',
      '"Step, Name"',
    ]);
  });

  it("pulls message + entity + stage from a plugin step registration", () => {
    const parsed = parseRegistrationArgs(
      'MessageNameEnum.Update, "account", StageEnum.PostOperation, ExecutionModeEnum.Synchronous, "name,telephone1", "Update account", 1, IsolationModeEnum.Sandbox, Id = "abc"',
    );
    expect(parsed).toEqual({ message: "Update", primaryEntity: "account", stage: "PostOperation" });
  });

  it("returns undefined for a non-plugin-step (workflow) registration", () => {
    expect(parseRegistrationArgs('"WorkflowActivity", "My Workflow", "desc", "group", IsolationModeEnum.Sandbox')).toBeUndefined();
  });
});
