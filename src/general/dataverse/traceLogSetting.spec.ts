import { describe, expect, it } from "vitest";
import { traceLogLabel, organizationTraceLogQuery } from "./traceLogSetting";

describe("trace log setting", () => {
  it("labels + colours each level (green → orange → red)", () => {
    expect(traceLogLabel(0)).toEqual({ label: "Trace: Off", colour: "green" });
    expect(traceLogLabel(1)).toEqual({ label: "Trace: Errors", colour: "orange" });
    expect(traceLogLabel(2)).toEqual({ label: "Trace: All", colour: "red" });
  });

  it("reads the org id + setting from the single organization row", () => {
    expect(organizationTraceLogQuery()).toBe("organizations?$select=organizationid,plugintracelogsetting");
  });
});
