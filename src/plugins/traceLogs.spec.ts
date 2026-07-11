import { describe, it, expect } from "vitest";
import { formatTraceLog } from "./traceLogs";

describe("formatTraceLog", () => {
  it("formats a successful trace with metadata and trace block", () => {
    const doc = formatTraceLog({
      plugintracelogid: "1",
      typename: "Contoso.Plugins.ContactSync",
      messagename: "Update",
      primaryentity: "contact",
      operationtype: 1,
      mode: 0,
      depth: 1,
      performanceexecutionduration: 42,
      messageblock: "Entered Execute\nDone",
      correlationid: "c-1",
      createdon: "2026-07-11T12:00:00Z",
    });
    expect(doc).toContain("# Plugin trace — Contoso.Plugins.ContactSync");
    expect(doc).toContain("| Operation | Plug-in |");
    expect(doc).toContain("| Mode | Synchronous |");
    expect(doc).toContain("| Duration | 42 ms |");
    expect(doc).toContain("Entered Execute");
    expect(doc).not.toContain("## Exception");
  });

  it("includes the exception section when present and hints when the trace is empty", () => {
    const doc = formatTraceLog({ plugintracelogid: "2", exceptiondetails: "System.InvalidPluginExecutionException: boom" });
    expect(doc).toContain("## Exception");
    expect(doc).toContain("boom");
    expect(doc).toContain("ITracingService.Trace");
  });
});
