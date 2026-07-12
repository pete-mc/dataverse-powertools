import { describe, expect, it } from "vitest";
import { auditLog, formatAuditReport } from "./logAudit";

describe("auditLog", () => {
  it("flags the exact failures the coded gates missed (the 0x80048425 run)", () => {
    const log = [
      "Saving Forms...",
      "Saving Form: 8448b78f-8f42-454e-8e2a-f8196b0419af",
      `Failed to save form '8448b78f': 400 Bad Request — {"error":{"code":"0x80048425","message":"The Form XML does not conform to the required schema. The required attribute 'name' is missing."}}`,
      "Publishing All Customisations",
      `Failed to publish customizations: 429 {"error":{"code":"0x80071151","message":"Cannot start another [PublishAll]..."}}`,
      "Publish Complete",
    ].join("\n");
    const findings = auditLog(log);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.some((f) => f.text.includes("Failed to save form"))).toBe(true);
    expect(findings.some((f) => f.text.includes("Failed to publish customizations"))).toBe(true);
  });

  it("passes a clean happy-path log", () => {
    const log = [
      "Saving Forms...",
      "Saving Form: 8448b78f-8f42-454e-8e2a-f8196b0419af",
      "Publishing All Customisations",
      "Publish Complete",
      "Building Complete",
      "webpack 5.108.4 compiled successfully in 5000 ms",
      "Build succeeded. 0 Warning(s) 0 Error(s)",
      "Typings have been generated.",
    ].join("\n");
    expect(auditLog(log)).toEqual([]);
  });

  it("does not flag the handled publish busy-retry", () => {
    expect(auditLog("A publish is already running — retrying in 20s (1/7)…\nPublish Complete")).toEqual([]);
  });

  it("flags network errors and HRESULTs", () => {
    const findings = auditLog("request to https://login.microsoftonline.com failed, reason: getaddrinfo ENOTFOUND login.microsoftonline.com");
    expect(findings).toHaveLength(1);
  });

  it("does not flag 'Unchanged' in sync summaries (contains 'hang')", () => {
    expect(auditLog("Plugin step sync complete. Created: 0, Updated: 0, Unchanged: 3, Skipped: 0.")).toEqual([]);
    expect(auditLog("the page hangs on load")).toHaveLength(1);
  });

  it("deduplicates repeated identical lines", () => {
    const findings = auditLog("Error registering events.\nError registering events.\nError registering events.");
    expect(findings).toHaveLength(1);
  });

  it("reports line numbers for findings", () => {
    const findings = auditLog("ok\nok\nFailed to save form 'x'");
    expect(findings[0].line).toBe(3);
  });
});

describe("formatAuditReport", () => {
  it("prints a pass line for no findings", () => {
    expect(formatAuditReport([], 100)).toMatch(/no unexplained/);
  });

  it("lists each finding with its line", () => {
    const report = formatAuditReport([{ line: 3, text: "Failed to save form 'x'", pattern: "failure" }], 100);
    expect(report).toMatch(/line 3 \[failure\] Failed to save form/);
  });
});
